import type { Diagnostic } from "../diagnostics.ts";
import type { FlowContent, PhrasingContent, SourceSpan } from "../model.ts";
import type { SourceRange } from "../ranges.ts";
import type { SourceFile } from "../source.ts";
import type { ResolvedSyntaxOptions } from "../syntax-options.ts";
import type { BlockSyntax, DirectiveAttributeSyntax } from "./block-syntax.ts";
import type { ResolvedParserLimits } from "./config.ts";
import type { FootnoteReferenceSyntax, InlineSyntax, ReferenceSyntax } from "./inline-syntax.ts";

import { createDiagnostic, DiagnosticBag } from "../diagnostics.ts";
import { decodeFrontmatter } from "../frontmatter.ts";
import { normalizeIdentifier } from "../identifier.ts";
import {
  BlockExpressionNode,
  BlockQuoteNode,
  CodeBlockNode,
  ContainerDirectiveNode,
  DirectiveAttribute,
  DirectiveAttributes,
  DirectiveLabelNode,
  DefinitionNode,
  DeleteNode,
  DisplayMathNode,
  DocumentNode,
  EmphasisNode,
  EsmNode,
  FootnoteDefinitionNode,
  FootnoteReferenceNode,
  FrontmatterNode,
  HardBreakNode,
  HeadingNode,
  ImageNode,
  ImageReferenceNode,
  InlineCodeNode,
  InlineExpressionNode,
  InlineMathNode,
  JsxAttributeNode,
  JsxAttributeValueExpressionNode,
  JsxFlowElementNode,
  JsxSpreadAttributeNode,
  JsxTextElementNode,
  LinkNode,
  LinkReferenceNode,
  ListItemNode,
  ListNode,
  LeafDirectiveNode,
  ParagraphNode,
  RawHtmlBlockNode,
  RawHtmlInlineNode,
  StrongNode,
  TableCellNode,
  TableNode,
  TableRowNode,
  TextDirectiveNode,
  TextNode,
  ThematicBreakNode,
} from "../model.ts";
import { InlineInput } from "./inline-input.ts";
import { parseInline } from "./inline-parser.ts";

export type ReferenceCandidate = ReferenceSyntax | FootnoteReferenceSyntax;

export interface MaterializedBlock {
  readonly node: FlowContent;
  readonly candidates: readonly ReferenceCandidate[];
}

export type StrictMaterializeResult =
  | Readonly<{
      kind: "parsed";
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

interface MaterializeContext {
  readonly definitions: ReadonlySet<string>;
  readonly diagnostics: DiagnosticBag;
  readonly file: SourceFile;
  readonly footnotes: ReadonlySet<string>;
  readonly limits: ResolvedParserLimits;
  readonly syntax: ResolvedSyntaxOptions;
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
    const child = materializeBlock(block, context);
    if (child !== undefined) {
      children.push(child);
      materializedBlocks.push(
        Object.freeze({ node: child, candidates: Object.freeze(candidates) }),
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
  const document = counted(context, new DocumentNode(children, origin(file, 0, file.text.length)));
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
    kind: "parsed",
    document,
    blocks: Object.freeze(materializedBlocks),
    diagnostics,
  });
}

function materializeBlock(
  block: BlockSyntax,
  context: MaterializeContext,
): FlowContent | undefined {
  if (!enter(context)) {
    return;
  }
  try {
    const blockOrigin = origin(context.file, block.range.start, block.range.end);
    switch (block.kind) {
      case "paragraph":
        return counted(
          context,
          new ParagraphNode(materializeInline(block.input, context), blockOrigin),
        );
      case "heading":
        return counted(
          context,
          new HeadingNode(block.depth, materializeInline(block.input, context), blockOrigin),
        );
      case "code":
        return counted(
          context,
          new CodeBlockNode(trimFinalLineEnding(inlineInputText(context.file, block.value)), {
            language: sliceOptional(context.file, block.language),
            meta: sliceOptional(context.file, block.meta),
            origin: blockOrigin,
          }),
        );
      case "thematicBreak":
        return counted(context, new ThematicBreakNode(blockOrigin));
      case "blockQuote":
        return counted(
          context,
          new BlockQuoteNode(materializeBlocks(block.children, context), blockOrigin),
        );
      case "list":
        return counted(
          context,
          new ListNode(
            block.items.map(
              (item) =>
                new ListItemNode(materializeBlocks(item.children, context), {
                  checked: item.checked,
                  spread: item.spread,
                  origin: origin(context.file, item.range.start, item.range.end),
                }),
            ),
            {
              ordered: block.ordered,
              spread: block.spread,
              start: block.start,
              origin: blockOrigin,
            },
          ),
        );
      case "definition":
        return counted(
          context,
          new DefinitionNode(block.identifier, context.file.semanticSlice(block.destination), {
            title: semanticSliceOptional(context.file, block.title),
            origin: blockOrigin,
          }),
        );
      case "footnoteDefinition":
        return counted(
          context,
          new FootnoteDefinitionNode(block.identifier, materializeBlocks(block.children, context), {
            origin: blockOrigin,
          }),
        );
      case "rawHtml":
        return counted(
          context,
          new RawHtmlBlockNode(context.file.semanticSlice(block.range), blockOrigin),
        );
      case "frontmatter": {
        const rawValue = trimFinalLineEnding(context.file.slice(block.value));
        const value = rawValue.replace(/\r\n?|\n/gu, "\n");
        const valueOrigin = origin(
          context.file,
          block.value.start,
          block.value.start + rawValue.length,
        );
        const data = decodeFrontmatter({
          diagnostics: context.diagnostics,
          format: block.format,
          source: rawValue,
          span: valueOrigin,
        });
        return counted(
          context,
          new FrontmatterNode(block.format, value, { data, origin: blockOrigin, valueOrigin }),
        );
      }
      case "directive":
        return counted(
          context,
          new ContainerDirectiveNode(block.name, materializeBlocks(block.children, context), {
            label: materializeDirectiveLabel(block.label, context),
            attributes: materializeDirectiveAttributes(block.attributes),
            origin: blockOrigin,
          }),
        );
      case "leafDirective":
        return counted(
          context,
          new LeafDirectiveNode(block.name, {
            label: materializeDirectiveLabel(block.label, context),
            attributes: materializeDirectiveAttributes(block.attributes),
            origin: blockOrigin,
          }),
        );
      case "math":
        return counted(
          context,
          block.format === "tex"
            ? new DisplayMathNode(trimFinalLineEnding(inlineInputText(context.file, block.value)), {
                format: "tex",
                origin: blockOrigin,
              })
            : new DisplayMathNode(trimFinalLineEnding(inlineInputText(context.file, block.value)), {
                format: "dollar",
                meta: sliceOptional(context.file, block.meta),
                origin: blockOrigin,
              }),
        );
      case "table":
        return counted(
          context,
          new TableNode(
            block.alignments,
            block.rows.map(
              (row) =>
                new TableRowNode(
                  row.cells.map((cell) => {
                    const cellRange = inlineSegmentsRange(cell, row.range);
                    return new TableCellNode(
                      materializeInline(cell, context),
                      origin(context.file, cellRange.start, cellRange.end),
                    );
                  }),
                  origin(context.file, row.range.start, row.range.end),
                ),
            ),
            blockOrigin,
          ),
        );
      case "expression": {
        const authored = context.file.slice(block.range);
        return counted(
          context,
          new BlockExpressionNode(
            authored.slice(authored.indexOf("{") + 1, authored.lastIndexOf("}")),
            blockOrigin,
          ),
        );
      }
      case "esm":
        return counted(
          context,
          new EsmNode(trimFinalLineEnding(context.file.slice(block.range)), blockOrigin),
        );
      case "jsx":
        return counted(
          context,
          materializeFlowJsx(context.file.slice(block.range), blockOrigin, context),
        );
      case "invalidMdx":
        context.authoredInvalid = true;
        context.diagnostics.add({
          code: `mdx.${block.syntax}.invalid`,
          message: `Invalid or unfinished MDX ${block.syntax}`,
          severity: "error",
          span: blockOrigin,
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
    context.authoredInvalid = true;
    context.diagnostics.add({
      code: `mdx.${invalid.syntax}.invalid`,
      message: `Invalid or unfinished MDX ${invalid.syntax}`,
      severity: "error",
      span: origin(context.file, invalid.range.start, invalid.range.end),
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
  const nodeOrigin = origin(context.file, node.range.start, node.range.end);
  const children =
    "children" in node
      ? node.children.flatMap((child) => materializeInlineNode(child, context))
      : [];
  switch (node.kind) {
    case "text":
      return countedArray(context, new TextNode(node.value, nodeOrigin));
    case "emphasis":
      return countedArray(context, new EmphasisNode(children, nodeOrigin));
    case "strong":
      return countedArray(context, new StrongNode(children, nodeOrigin));
    case "delete":
      return countedArray(context, new DeleteNode(children, nodeOrigin));
    case "code":
      return countedArray(context, new InlineCodeNode(node.value, nodeOrigin));
    case "hardBreak":
      return countedArray(context, new HardBreakNode(nodeOrigin));
    case "link":
      return countedArray(
        context,
        new LinkNode(node.destination, children, { title: node.title, origin: nodeOrigin }),
      );
    case "image":
      return countedArray(
        context,
        new ImageNode(node.destination, node.alt, { title: node.title, origin: nodeOrigin }),
      );
    case "reference":
      if (!context.definitions.has(node.identifier)) {
        return countedArray(context, new TextNode(context.file.slice(node.range), nodeOrigin));
      }
      return countedArray(
        context,
        node.image
          ? new ImageReferenceNode(
              node.identifier,
              children.map((child) => child.toString()).join(""),
              {
                referenceKind: node.referenceKind,
                origin: nodeOrigin,
              },
            )
          : new LinkReferenceNode(node.identifier, children, {
              referenceKind: node.referenceKind,
              origin: nodeOrigin,
            }),
      );
    case "rawHtml":
      return countedArray(context, new RawHtmlInlineNode(node.value, nodeOrigin));
    case "expression":
      return countedArray(context, new InlineExpressionNode(node.value, nodeOrigin));
    case "jsx":
      return countedArray(context, materializeTextJsx(node.value, nodeOrigin, context));
    case "math":
      return countedArray(
        context,
        new InlineMathNode(node.value, { format: node.format, origin: nodeOrigin }),
      );
    case "footnoteReference":
      return context.footnotes.has(node.identifier)
        ? countedArray(context, new FootnoteReferenceNode(node.identifier, { origin: nodeOrigin }))
        : countedArray(context, new TextNode(context.file.slice(node.range), nodeOrigin));
    case "directive":
      return countedArray(
        context,
        new TextDirectiveNode(node.name, {
          label: new DirectiveLabelNode(children, nodeOrigin),
          attributes: new DirectiveAttributes(
            node.attributes.map(
              (attribute) => new DirectiveAttribute(attribute.name, attribute.value),
            ),
          ),
          origin: nodeOrigin,
        }),
      );
  }
}

function materializeDirectiveLabel(
  label: ConstructorParameters<typeof InlineInput>[1] | undefined,
  context: MaterializeContext,
): DirectiveLabelNode | undefined {
  if (label === undefined) {
    return;
  }
  const range = inlineSegmentsRange(label, { start: 0, end: 0 });
  return new DirectiveLabelNode(
    materializeInline(label, context),
    origin(context.file, range.start, range.end),
  );
}

function materializeDirectiveAttributes(
  attributes: readonly DirectiveAttributeSyntax[],
): DirectiveAttributes {
  return new DirectiveAttributes(
    attributes.map((attribute) => new DirectiveAttribute(attribute.name, attribute.value)),
  );
}

function materializeFlowJsx(
  authored: string,
  jsxOrigin: SourceSpan,
  context: MaterializeContext,
): JsxFlowElementNode {
  const parsed = jsxParts(context.file, authored, jsxOrigin.start);
  const children =
    parsed.children === undefined || parsed.children.start === parsed.children.end
      ? []
      : [
          new ParagraphNode(
            materializeInline([{ kind: "source", range: parsed.children }], context),
            origin(context.file, parsed.children.start, parsed.children.end),
          ),
        ];
  return new JsxFlowElementNode(parsed.name, parsed.attributes, children, jsxOrigin);
}

function materializeTextJsx(
  authored: string,
  jsxOrigin: SourceSpan,
  context: MaterializeContext,
): JsxTextElementNode {
  const parsed = jsxParts(context.file, authored, jsxOrigin.start);
  const children =
    parsed.children === undefined
      ? []
      : materializeInline([{ kind: "source", range: parsed.children }], context);
  return new JsxTextElementNode(parsed.name, parsed.attributes, children, jsxOrigin);
}

interface JsxParts {
  readonly attributes: readonly (JsxAttributeNode | JsxSpreadAttributeNode)[];
  readonly children: SourceRange | undefined;
  readonly name: string | undefined;
}

function jsxParts(file: SourceFile, authored: string, sourceOffset: number): JsxParts {
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
    attributes: jsxAttributes(file, authored, sourceOffset, name?.length ?? 0, openingEnd),
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

function jsxAttributes(
  file: SourceFile,
  authored: string,
  sourceOffset: number,
  nameLength: number,
  openingEnd: number,
): (JsxAttributeNode | JsxSpreadAttributeNode)[] {
  const attributes: (JsxAttributeNode | JsxSpreadAttributeNode)[] = [];
  const start = nameLength === 0 ? 1 : nameLength + 1;
  const source = authored.slice(start, Math.max(start, openingEnd - 1)).replace(/\/$/u, "");
  const pattern =
    /\{\.\.\.([^}]+)\}|([A-Za-z_$][\w$:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\}))?/gu;
  for (const match of source.matchAll(pattern)) {
    const attributeStart = sourceOffset + start + (match.index ?? 0);
    const attributeEnd = attributeStart + match[0].length;
    const attributeOrigin = origin(file, attributeStart, attributeEnd);
    if (match[1] !== undefined) {
      attributes.push(new JsxSpreadAttributeNode(match[1], attributeOrigin));
    } else if (match[2] !== undefined) {
      const expression =
        match[5] === undefined
          ? undefined
          : new JsxAttributeValueExpressionNode(match[5], attributeOrigin);
      attributes.push(
        new JsxAttributeNode(match[2], {
          value: expression ?? match[3] ?? match[4],
          origin: attributeOrigin,
        }),
      );
    }
  }
  return attributes;
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

function origin(file: SourceFile, start: number, end: number): SourceSpan {
  return { file, start, end };
}

function enter(context: MaterializeContext): boolean {
  context.depth++;
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
    span: origin(file, 0, file.text.length),
  });
}
