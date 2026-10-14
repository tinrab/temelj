import { isString } from "@temelj/value";

import type { Diagnostic } from "../diagnostics.ts";
import type {
  DirectiveAttribute,
  DirectiveLabelNode,
  ListItemNode,
  DocumentNode,
  FlowContent,
  JsxAttributeLike,
  JsxTextElementNode,
  PhrasingContent,
} from "../model.ts";
import type { SourceRange } from "../ranges.ts";
import type { SourceFile, SourceSpan } from "../source.ts";
import type { ResolvedSyntaxOptions } from "../syntax-options.ts";
import type { BlockSyntax, DirectiveAttributeSyntax, ListItemSyntax } from "./block-syntax.ts";
import type { ResolvedParserLimits } from "./config.ts";
import type { FootnoteReferenceSyntax, InlineSyntax, ReferenceSyntax } from "./inline-syntax.ts";

import { createDiagnostic, DiagnosticBag } from "../diagnostics.ts";
import { decodeFrontmatter } from "../frontmatter.ts";
import { normalizeIdentifier } from "../identifier.ts";
import { childNode, nodeArray, nodeValue, type JavaScriptNode } from "../javascript-ast.ts";
import { parseJavaScriptExpression } from "../javascript.ts";
import { nodeText } from "../model.ts";
import { parseFlowRange } from "./block-parser.ts";
import { InlineInput } from "./inline-input.ts";
import { parseInline } from "./inline-parser.ts";

export type ReferenceCandidate = ReferenceSyntax | FootnoteReferenceSyntax;

export interface MaterializedBlock {
  readonly nodeCount: number;
  readonly node: FlowContent;
  readonly candidates: readonly ReferenceCandidate[];
}

export type StrictMaterializeResult =
  | Readonly<{
      kind: "ok";
      document: DocumentNode;
      blocks: readonly MaterializedBlock[];
      diagnostics: readonly Diagnostic[];
    }>
  | Readonly<{ kind: "invalid"; diagnostics: readonly [Diagnostic, ...Diagnostic[]] }>
  | Readonly<{
      kind: "limitExceeded";
      limit: "maximumNestingDepth" | "maximumNodes";
      diagnostics: readonly [Diagnostic, ...Diagnostic[]];
    }>;

interface CachedMaterialization<TNode> {
  readonly node: TNode;
  readonly nodeCount: number;
  readonly depth: number;
  readonly candidates: readonly ReferenceCandidate[];
}

/**
 * Materialized nodes keyed by parser output identity. A cache is valid only for
 * one set of defined references and footnotes, because resolution depends on it.
 */
export interface MaterializeCache {
  readonly blocks: WeakMap<BlockSyntax, CachedMaterialization<FlowContent>>;
  readonly items: WeakMap<ListItemSyntax, CachedMaterialization<ListItemNode>>;
}

export function createMaterializeCache(): MaterializeCache {
  return { blocks: new WeakMap(), items: new WeakMap() };
}

interface MaterializeContext {
  readonly definitions: ReadonlySet<string>;
  readonly diagnostics: DiagnosticBag;
  readonly file: SourceFile;
  readonly footnotes: ReadonlySet<string>;
  readonly limits: ResolvedParserLimits;
  readonly syntax: ResolvedSyntaxOptions;
  readonly allowIncomplete: boolean;
  readonly cache: MaterializeCache | undefined;
  grammarSource: string | undefined;
  maximumDepth: number;
  /** Leniency at the end of the source makes the result depend on later input. */
  usedEndOfInput: boolean;
  candidates: ReferenceCandidate[] | undefined;
  depth: number;
  nodes: number;
  authoredInvalid: boolean;
  limit: "maximumNestingDepth" | "maximumNodes" | undefined;
}

export function materializeStrictDocument(
  file: SourceFile,
  blocks: readonly BlockSyntax[],
  syntax: ResolvedSyntaxOptions,
  limits: ResolvedParserLimits,
  allowIncomplete = false,
  cache?: MaterializeCache,
): StrictMaterializeResult {
  const indexes = collectIndexes(blocks);

  const context: MaterializeContext = {
    definitions: indexes.definitions,
    diagnostics: new DiagnosticBag(),
    file,
    footnotes: indexes.footnotes,
    limits,
    syntax,
    candidates: undefined,
    cache,
    grammarSource: undefined,
    maximumDepth: 0,
    usedEndOfInput: false,
    allowIncomplete,
    depth: 0,
    nodes: 0,
    authoredInvalid: false,
    limit: undefined,
  };

  const children: FlowContent[] = [];
  const materializedBlocks: MaterializedBlock[] = [];

  for (const block of blocks) {
    const candidates: ReferenceCandidate[] = [];
    context.candidates = candidates;
    const before = context.nodes;
    const child = materializeBlock(block, context);

    if (child !== undefined) {
      children.push(child);
      materializedBlocks.push(
        Object.freeze({
          node: child,
          nodeCount: context.nodes - before,
          candidates: Object.freeze(candidates),
        }),
      );
    }
  }

  context.candidates = undefined;

  if (context.limit !== undefined) {
    const diagnostic = limitDiagnostic(file, context.limit);
    const diagnostics: readonly [Diagnostic] = Object.freeze([diagnostic]);

    return Object.freeze({
      kind: "limitExceeded",
      limit: context.limit,
      diagnostics,
    });
  }

  const diagnostics = context.diagnostics.snapshot();

  if (context.authoredInvalid) {
    const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");

    if (errors.length === 0) {
      throw new Error("Invalid MDX draft did not produce an error diagnostic");
    }

    const [first, ...rest] = errors;

    if (first === undefined) {
      throw new Error("Invalid MDX diagnostic collection changed unexpectedly");
    }

    const invalidDiagnostics: readonly [Diagnostic, ...Diagnostic[]] = Object.freeze([
      first,
      ...rest,
    ]);

    return Object.freeze({
      kind: "invalid",
      diagnostics: invalidDiagnostics,
    });
  }

  const document = counted<DocumentNode>(context, {
    kind: "document",
    children,
    origin: range(0, file.text.length),
  });

  if (document === undefined || context.limit !== undefined) {
    const diagnostic = limitDiagnostic(file, "maximumNodes");
    const diagnostics: readonly [Diagnostic] = Object.freeze([diagnostic]);

    return Object.freeze({
      kind: "limitExceeded",
      limit: "maximumNodes",
      diagnostics,
    });
  }

  return Object.freeze({
    kind: "ok",
    document,
    blocks: Object.freeze(materializedBlocks),
    diagnostics,
  });
}

function materializeBlock(
  block: BlockSyntax,
  context: MaterializeContext,
): FlowContent | undefined {
  return cached(context.cache?.blocks, block, context, () =>
    materializeBlockContent(block, context),
  );
}

/**
 * Replays a cached subtree, or materializes and caches it. Subtrees with
 * diagnostics or input-dependent leniency are never cached.
 */
function cached<TKey extends BlockSyntax | ListItemSyntax, TNode>(
  cache: WeakMap<TKey, CachedMaterialization<TNode>> | undefined,
  key: TKey,
  context: MaterializeContext,
  materialize: () => TNode | undefined,
): TNode | undefined {
  if (cache === undefined) {
    return materialize();
  }

  const hit = cache.get(key);

  if (
    hit !== undefined &&
    context.depth + hit.depth <= context.limits.maximumNestingDepth &&
    context.nodes + hit.nodeCount <= context.limits.maximumNodes
  ) {
    context.nodes += hit.nodeCount;
    context.maximumDepth = Math.max(context.maximumDepth, context.depth + hit.depth);
    context.candidates?.push(...hit.candidates);

    return hit.node;
  }

  const nodes = context.nodes;
  const diagnostics = context.diagnostics.size;
  const candidates = context.candidates?.length ?? 0;
  const outerDepth = context.maximumDepth;
  const outerEndOfInput = context.usedEndOfInput;
  context.maximumDepth = context.depth;
  context.usedEndOfInput = false;
  const node = materialize();

  if (
    node !== undefined &&
    context.diagnostics.size === diagnostics &&
    !context.authoredInvalid &&
    context.limit === undefined &&
    !context.usedEndOfInput
  ) {
    cache.set(key, {
      node,
      nodeCount: context.nodes - nodes,
      depth: context.maximumDepth - context.depth,
      candidates: context.candidates?.slice(candidates) ?? [],
    });
  }

  context.maximumDepth = Math.max(outerDepth, context.maximumDepth);
  context.usedEndOfInput ||= outerEndOfInput;

  return node;
}

function materializeBlockContent(
  block: BlockSyntax,
  context: MaterializeContext,
): FlowContent | undefined {
  if (!enter(context)) {
    return;
  }

  try {
    const origin = range(block.range.start, block.range.end);

    switch (block.kind) {
      case "paragraph":
        return counted(context, {
          kind: "paragraph",
          children: materializeInline(block.input, context),
          origin,
        });
      case "heading":
        return counted(context, {
          kind: "heading",
          depth: block.depth,
          children: materializeInline(block.input, context),
          origin,
        });
      case "code":
        return counted(context, {
          kind: "codeBlock",
          value: trimFinalLineEnding(inlineInputText(context.file, block.value)),
          language: sliceOptional(context.file, block.language),
          meta: sliceOptional(context.file, block.meta),
          origin,
        });
      case "thematicBreak":
        return counted(context, { kind: "thematicBreak", origin });
      case "blockQuote":
        return counted(context, {
          kind: "blockquote",
          children: materializeBlocks(block.children, context),
          origin,
        });
      case "list":
        return counted(context, {
          kind: "list",
          ordered: block.ordered,
          spread: block.spread,
          start: block.start ?? 1,
          children: block.items.flatMap((item) => {
            const node = cached(context.cache?.items, item, context, (): ListItemNode => ({
              kind: "listItem",
              checked: item.checked,
              spread: item.spread,
              children: materializeBlocks(item.children, context),
              origin: range(item.range.start, item.range.end),
            }));

            return node === undefined ? [] : [node];
          }),
          origin,
        });
      case "definition":
        return counted(context, {
          kind: "definition",
          identifier: normalizeIdentifier(block.identifier),
          url: context.file.semanticSlice(block.destination),
          title: semanticSliceOptional(context.file, block.title),
          origin,
        });
      case "footnoteDefinition":
        return counted(context, {
          kind: "footnoteDefinition",
          identifier: normalizeIdentifier(block.identifier),
          label: block.identifier,
          children: materializeBlocks(block.children, context),
          origin,
        });
      case "rawHtml":
        return counted(context, {
          kind: "rawHtmlBlock",
          value: context.file.semanticSlice(block.range),
          origin,
        });
      case "frontmatter": {
        const rawValue = trimFinalLineEnding(context.file.slice(block.value));
        const valueOrigin = range(block.value.start, block.value.start + rawValue.length);

        const data = decodeFrontmatter({
          diagnostics: context.diagnostics,
          format: block.format,
          source: rawValue,
          span: span(context.file, valueOrigin.start, valueOrigin.end),
        });

        return counted(context, {
          kind: "frontmatter",
          format: block.format,
          value: rawValue.replace(/\r\n?|\n/gu, "\n"),
          data,
          valueOrigin,
          origin,
        });
      }

      case "directive":
        return counted(context, {
          kind: "containerDirective",
          name: block.name,
          attributes: materializeDirectiveAttributes(block.attributes),
          label: materializeDirectiveLabel(block.label, context),
          children: materializeBlocks(block.children, context),
          origin,
        });
      case "leafDirective":
        return counted(context, {
          kind: "leafDirective",
          name: block.name,
          attributes: materializeDirectiveAttributes(block.attributes),
          label: materializeDirectiveLabel(block.label, context),
          origin,
        });
      case "math": {
        const value = trimFinalLineEnding(inlineInputText(context.file, block.value));

        return counted(
          context,
          block.format === "tex"
            ? { kind: "displayMath", value, format: "tex", origin }
            : {
                kind: "displayMath",
                value,
                format: "dollar",
                meta: sliceOptional(context.file, block.meta),
                origin,
              },
        );
      }

      case "table":
        return counted(context, {
          kind: "table",
          alignments: block.alignments,
          children: block.rows.map((row) => ({
            kind: "tableRow",
            children: row.cells.map((cell) => {
              const cellRange = inlineSegmentsRange(cell, row.range);

              return {
                kind: "tableCell",
                children: materializeInline(cell, context),
                origin: range(cellRange.start, cellRange.end),
              };
            }),
            origin: range(row.range.start, row.range.end),
          })),
          origin,
        });
      case "expression": {
        const authored = context.file.slice(block.range);

        return counted(context, {
          kind: "blockExpression",
          code: authored.slice(authored.indexOf("{") + 1, authored.lastIndexOf("}")),
          origin,
        });
      }

      case "esm":
        return counted(context, {
          kind: "esm",
          code: trimFinalLineEnding(context.file.slice(block.range)),
          origin,
        });
      case "jsx":
        return counted(
          context,
          materializeFlowJsx(context.file.slice(block.range), origin, context),
        );
      case "invalidMdx":
        if (context.allowIncomplete && block.state === "incomplete") {
          context.usedEndOfInput = true;

          return counted(context, {
            kind: "rawHtmlBlock",
            value: context.file.slice(block.range),
            origin,
          });
        }

        context.authoredInvalid = true;
        context.diagnostics.add({
          code: `mdx.${block.syntax}.invalid`,
          message: `Invalid or unfinished MDX ${block.syntax}`,
          severity: "error",
          span: span(context.file, origin.start, origin.end),
        });

        return;
    }
  } finally {
    context.depth--;
  }
}

function materializeBlocks(
  blocks: readonly BlockSyntax[],
  context: MaterializeContext,
): FlowContent[] {
  const children: FlowContent[] = [];

  for (const block of blocks) {
    const child = materializeBlock(block, context);

    if (child !== undefined) {
      children.push(child);
    }
  }

  return children;
}

function materializeInline(
  segments: Parameters<typeof inlineInputText>[1],
  context: MaterializeContext,
): PhrasingContent[] {
  const result = parseInline(new InlineInput(context.file, segments), context.syntax);

  if (context.candidates !== undefined) {
    collectReferenceCandidates(result.nodes, context.candidates);
  }

  for (const invalid of result.invalid) {
    // Streaming input can still close a construct that reaches the end of the source.
    if (
      context.allowIncomplete &&
      invalid.open &&
      /^[ \t]*(?:\r\n?|\n)?[ \t]*$/u.test(context.file.text.slice(invalid.range.end))
    ) {
      context.usedEndOfInput = true;
      continue;
    }

    context.authoredInvalid = true;
    context.diagnostics.add({
      code: `mdx.${invalid.syntax}.invalid`,
      message: `Invalid or unfinished MDX ${invalid.syntax}`,
      severity: "error",
      span: span(context.file, invalid.range.start, invalid.range.end),
    });
  }

  return result.nodes.flatMap((node) => materializeInlineNode(node, context));
}

function collectReferenceCandidates(
  nodes: readonly InlineSyntax[],
  candidates: ReferenceCandidate[],
): void {
  for (const node of nodes) {
    if (node.kind === "reference" || node.kind === "footnoteReference") {
      candidates.push(node);
    }

    if ("children" in node) {
      collectReferenceCandidates(node.children, candidates);
    }

    if (node.kind === "directive") {
      collectReferenceCandidates(node.label, candidates);
    }
  }
}

function materializeInlineNode(node: InlineSyntax, context: MaterializeContext): PhrasingContent[] {
  const origin = range(node.range.start, node.range.end);

  const children =
    "children" in node
      ? node.children.flatMap((child) => materializeInlineNode(child, context))
      : [];

  switch (node.kind) {
    case "text":
      return countedArray(context, { kind: "text", value: node.value, origin });
    case "emphasis":
    case "strong":
    case "delete":
      return countedArray(context, { kind: node.kind, children, origin });
    case "code":
      return countedArray(context, { kind: "inlineCode", value: node.value, origin });
    case "hardBreak":
      return countedArray(context, { kind: "hardBreak", origin });
    case "link":
      return countedArray(context, {
        kind: "link",
        url: node.destination,
        title: node.title,
        children,
        origin,
      });
    case "image":
      return countedArray(context, {
        kind: "image",
        url: node.destination,
        alt: node.alt,
        title: node.title,
        origin,
      });
    case "reference": {
      if (!context.definitions.has(node.identifier)) {
        return countedArray(context, {
          kind: "text",
          value: context.file.slice(node.range),
          origin,
        });
      }

      const identifier = normalizeIdentifier(node.identifier);

      return countedArray(
        context,
        node.image
          ? {
              kind: "imageReference",
              identifier,
              alt: children.map(nodeText).join(""),
              referenceKind: node.referenceKind,
              origin,
            }
          : {
              kind: "linkReference",
              identifier,
              referenceKind: node.referenceKind,
              children,
              origin,
            },
      );
    }

    case "rawHtml":
      return countedArray(context, { kind: "rawHtmlInline", value: node.value, origin });
    case "expression":
      return countedArray(context, { kind: "inlineExpression", code: node.value, origin });
    case "jsx":
      return countedArray(context, materializeTextJsx(node.value, origin, context));
    case "math":
      return countedArray(context, {
        kind: "inlineMath",
        value: node.value,
        format: node.format,
        origin,
      });
    case "footnoteReference":
      return context.footnotes.has(node.identifier)
        ? countedArray(context, {
            kind: "footnoteReference",
            identifier: normalizeIdentifier(node.identifier),
            label: node.identifier,
            origin,
          })
        : countedArray(context, { kind: "text", value: context.file.slice(node.range), origin });
    case "directive":
      return countedArray(context, {
        kind: "textDirective",
        name: node.name,
        attributes: materializeDirectiveAttributes(node.attributes),
        label: { kind: "directiveLabel", children, origin },
        origin,
      });
  }
}

function materializeDirectiveLabel(
  label: ConstructorParameters<typeof InlineInput>[1] | undefined,
  context: MaterializeContext,
): DirectiveLabelNode | undefined {
  if (label === undefined) {
    return;
  }

  const labelRange = inlineSegmentsRange(label, { start: 0, end: 0 });

  return {
    kind: "directiveLabel",
    children: materializeInline(label, context),
    origin: range(labelRange.start, labelRange.end),
  };
}

function materializeDirectiveAttributes(
  attributes: readonly DirectiveAttributeSyntax[],
): DirectiveAttribute[] {
  return attributes.map((attribute) => ({ name: attribute.name, value: attribute.value }));
}

/**
 * Children on following lines are Markdown flow content. Like MDX, children on
 * the same line are phrasing: the element is text JSX in a paragraph, which
 * lowering does not wrap in `p`.
 */
function materializeFlowJsx(
  authored: string,
  jsxOrigin: SourceRange,
  context: MaterializeContext,
): FlowContent {
  const parsed = jsxParts(authored, jsxOrigin.start);
  const children = parsed.children;

  if (
    children !== undefined &&
    children.start !== children.end &&
    !isFlowJsxChildren(context.file.text, children)
  ) {
    return {
      kind: "paragraph",
      children: [materializeTextJsx(authored, jsxOrigin, context)],
      origin: jsxOrigin,
    };
  }

  return {
    kind: "jsxFlowElement",
    name: parsed.name,
    attributes: parsed.attributes,
    children:
      children === undefined || children.start === children.end
        ? []
        : materializeBlocks(
            parseFlowRange(grammarSource(context), children, context.syntax),
            context,
          ),
    origin: jsxOrigin,
  };
}

/** Children that start on a new line are Markdown flow content; same-line children are phrasing. */
export function isFlowJsxChildren(source: string, range: SourceRange): boolean {
  return /^[ \t]*(?:\r\n|\r|\n)/u.test(source.slice(range.start, range.end));
}

function grammarSource(context: MaterializeContext): string {
  context.grammarSource ??= context.file.text.replaceAll("\0", "\uFFFD");

  return context.grammarSource;
}

function materializeTextJsx(
  authored: string,
  jsxOrigin: SourceRange,
  context: MaterializeContext,
): JsxTextElementNode {
  const parsed = jsxParts(authored, jsxOrigin.start);

  return {
    kind: "jsxTextElement",
    name: parsed.name,
    attributes: parsed.attributes,
    children:
      parsed.children === undefined
        ? []
        : materializeInline([{ kind: "source", range: parsed.children }], context),
    origin: jsxOrigin,
  };
}

interface JsxParts {
  readonly attributes: readonly JsxAttributeLike[];
  readonly children: SourceRange | undefined;
  readonly name: string | undefined;
}

function jsxParts(authored: string, sourceOffset: number): JsxParts {
  if (authored.startsWith("<>")) {
    const close = authored.lastIndexOf("</>");

    return {
      attributes: [],
      children: close < 2 ? undefined : { start: sourceOffset + 2, end: sourceOffset + close },
      name: undefined,
    };
  }

  const name = /^<([A-Za-z_$][\w$:.-]*)/u.exec(authored)?.[1];
  const openingEnd = jsxOpeningEnd(authored);
  const selfClosing = authored.slice(0, openingEnd).trimEnd().endsWith("/>");
  const closingStart = name === undefined ? -1 : authored.lastIndexOf(`</${name}`);

  return {
    attributes: jsxAttributes(authored, sourceOffset, openingEnd),
    children:
      selfClosing || closingStart < openingEnd
        ? undefined
        : { start: sourceOffset + openingEnd, end: sourceOffset + closingStart },
    name,
  };
}

function jsxOpeningEnd(authored: string): number {
  let quote: "'" | '"' | undefined;
  let braces = 0;

  for (let offset = 1; offset < authored.length; offset++) {
    const character = authored[offset];

    if (quote !== undefined) {
      if (character === quote && !escapedAt(authored, offset)) {
        quote = undefined;
      }
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (character === "{") {
      braces++;
    } else if (character === "}") {
      braces--;
    } else if (character === ">" && braces === 0) {
      return offset + 1;
    }
  }

  return authored.length;
}

/** Reads attributes from the opening tag with the same JSX grammar that validated it. */
function jsxAttributes(
  authored: string,
  sourceOffset: number,
  openingEnd: number,
): JsxAttributeLike[] {
  const opening = authored.slice(0, openingEnd).replace(/\/?\s*>$/u, "/>");
  let element: JavaScriptNode;

  try {
    element = parseJavaScriptExpression(opening);
  } catch {
    return [];
  }

  const attributes = childNode(nodeValue(element, "openingElement"));

  return attributes === undefined
    ? []
    : nodeArray(attributes, "attributes").flatMap((attribute) =>
        jsxAttribute(attribute, opening, sourceOffset),
      );
}

function jsxAttribute(
  attribute: JavaScriptNode,
  opening: string,
  sourceOffset: number,
): JsxAttributeLike[] {
  const origin = range(sourceOffset + attribute.start, sourceOffset + attribute.end);

  if (attribute.type === "JSXSpreadAttribute") {
    const argument = childNode(nodeValue(attribute, "argument"));

    return argument === undefined
      ? []
      : [{ kind: "jsxSpreadAttribute", code: opening.slice(argument.start, argument.end), origin }];
  }

  const nameNode = childNode(nodeValue(attribute, "name"));
  const name = nameNode === undefined ? undefined : opening.slice(nameNode.start, nameNode.end);
  const value = childNode(nodeValue(attribute, "value"));

  if (name === undefined) {
    return [];
  }

  if (value === undefined) {
    return [{ kind: "jsxAttribute", name, origin }];
  }

  if (value.type === "JSXExpressionContainer") {
    const expression = childNode(nodeValue(value, "expression"));

    return [
      {
        kind: "jsxAttribute",
        name,
        value: {
          kind: "jsxAttributeValueExpression",
          code: expression === undefined ? "" : opening.slice(expression.start, expression.end),
          origin: range(sourceOffset + value.start, sourceOffset + value.end),
        },
        origin,
      },
    ];
  }

  // String literals keep JSX semantics, including decoded character references.
  const literal = nodeValue(value, "value");

  return [{ kind: "jsxAttribute", name, value: isString(literal) ? literal : "", origin }];
}

function escapedAt(value: string, offset: number): boolean {
  let slashes = 0;

  for (let index = offset - 1; index >= 0 && value[index] === "\\"; index--) {
    slashes++;
  }

  return slashes % 2 === 1;
}

interface DependencyIndexes {
  readonly definitions: ReadonlySet<string>;
  readonly footnotes: ReadonlySet<string>;
}

function collectIndexes(blocks: readonly BlockSyntax[]): DependencyIndexes {
  const definitions = new Set<string>();
  const footnotes = new Set<string>();

  const visit = (block: BlockSyntax): void => {
    if (block.kind === "definition") {
      definitions.add(normalizeIdentifier(block.identifier));
    } else if (block.kind === "footnoteDefinition") {
      footnotes.add(normalizeIdentifier(block.identifier));
    }

    if (
      block.kind === "blockQuote" ||
      block.kind === "footnoteDefinition" ||
      block.kind === "directive"
    ) {
      block.children.forEach(visit);
    } else if (block.kind === "list") {
      block.items.forEach((item) => item.children.forEach(visit));
    }
  };

  blocks.forEach(visit);

  return { definitions, footnotes };
}

function inlineInputText(
  file: SourceFile,
  segments: ConstructorParameters<typeof InlineInput>[1],
): string {
  return new InlineInput(file, segments).toString();
}

function inlineSegmentsRange(
  segments: ConstructorParameters<typeof InlineInput>[1],
  fallback: SourceRange,
): SourceRange {
  const first = segments.find((segment) => segment.kind === "source");
  const last = segments.findLast((segment) => segment.kind === "source");

  return first?.kind === "source" && last?.kind === "source"
    ? { start: first.range.start, end: last.range.end }
    : fallback;
}

function sliceOptional(file: SourceFile, range: SourceRange | undefined): string | undefined {
  return range === undefined ? undefined : file.slice(range);
}

function semanticSliceOptional(
  file: SourceFile,
  range: SourceRange | undefined,
): string | undefined {
  return range === undefined ? undefined : file.semanticSlice(range);
}

function trimFinalLineEnding(value: string): string {
  return value.endsWith("\r\n")
    ? value.slice(0, -2)
    : value.endsWith("\n") || value.endsWith("\r")
      ? value.slice(0, -1)
      : value;
}

function span(file: SourceFile, start: number, end: number): SourceSpan {
  return { file, start, end };
}

function range(start: number, end: number): SourceRange {
  return { start, end };
}

function enter(context: MaterializeContext): boolean {
  context.depth++;
  context.maximumDepth = Math.max(context.maximumDepth, context.depth);

  if (context.depth > context.limits.maximumNestingDepth) {
    context.limit = "maximumNestingDepth";
    context.depth--;

    return false;
  }

  return true;
}

function counted<T>(context: MaterializeContext, node: T): T | undefined {
  context.nodes++;

  if (context.nodes > context.limits.maximumNodes) {
    context.limit = "maximumNodes";

    return;
  }

  return node;
}

function countedArray<T extends PhrasingContent>(context: MaterializeContext, node: T): T[] {
  return counted(context, node) === undefined ? [] : [node];
}

function limitDiagnostic(
  file: SourceFile,
  limit: "maximumNestingDepth" | "maximumNodes",
): Diagnostic {
  return createDiagnostic({
    code: `mdx.limit.${limit}`,
    message: `Parser limit ${limit} exceeded`,
    severity: "error",
    span: span(file, 0, file.text.length),
  });
}
