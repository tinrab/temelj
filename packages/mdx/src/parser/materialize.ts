import type { Diagnostic } from "../diagnostics.ts";
import type {
  DirectiveAttribute,
  DirectiveLabelNode,
  ListItemNode,
  DocumentNode,
  FlowContent,
  JsxTextElementNode,
  PhrasingContent,
} from "../model.ts";
import type { SourceRange } from "../ranges.ts";
import type { SourceText } from "../source-text.ts";
import type { SourceFile, SourceSpan } from "../source.ts";
import type { ResolvedSyntaxOptions } from "../syntax-options.ts";
import type {
  BlockSyntax,
  DirectiveAttributeSyntax,
  ListItemSyntax,
  ListSyntax,
} from "./block-syntax.ts";
import type { ResolvedParserLimits } from "./config.ts";
import type { InlineSyntax } from "./inline-syntax.ts";
import type {
  CachedListPrefix,
  CachedMaterialization,
  MaterializeCache,
} from "./materialize-cache.ts";

import { createDiagnostic, DiagnosticBag } from "../diagnostics.ts";
import { decodeFrontmatter } from "../frontmatter.ts";
import { normalizeIdentifier } from "../identifier.ts";
import { nodeText } from "../model.ts";
import { sourceText } from "../source.ts";
import { parseFlowRange } from "./block-parser.ts";
import { InlineInput } from "./inline-input.ts";
import { parseInline } from "./inline-parser.ts";
import { isFlowJsxChildren, jsxParts } from "./materialize-jsx.ts";

export interface MaterializedBlock {
  readonly nodeCount: number;
  readonly node: FlowContent;
}

export interface MaterializeOptions {
  /**
   * Keeps references whose definitions are missing, for a stream where the
   * definitions may still arrive. Otherwise they become authored text.
   */
  readonly keepReferences?: boolean;
  /** Open embedded syntax at the end of the source is inert instead of invalid. */
  readonly allowIncomplete?: boolean;
  readonly cache?: MaterializeCache;
  /**
   * The range of a stream's open leaf. A stream renders that leaf itself, so it
   * materializes as an empty placeholder with the same kind and origin.
   */
  readonly open?: SourceRange;
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

interface MaterializeContext {
  readonly definitions: ReadonlySet<string>;
  readonly diagnostics: DiagnosticBag;
  readonly file: SourceFile;
  readonly footnotes: ReadonlySet<string>;
  readonly limits: ResolvedParserLimits;
  readonly syntax: ResolvedSyntaxOptions;
  readonly allowIncomplete: boolean;
  readonly keepReferences: boolean;
  readonly cache: MaterializeCache | undefined;
  readonly open: SourceRange | undefined;
  grammarSource: SourceText | undefined;
  maximumDepth: number;
  /** Leniency at the end of the source makes the result depend on later input. */
  usedEndOfInput: boolean;
  depth: number;
  nodes: number;
  authoredInvalid: boolean;
  limit: "maximumNestingDepth" | "maximumNodes" | undefined;
}

export function materializeDocument(
  file: SourceFile,
  blocks: readonly BlockSyntax[],
  syntax: ResolvedSyntaxOptions,
  limits: ResolvedParserLimits,
  options: MaterializeOptions = {},
): StrictMaterializeResult {
  // Kept references resolve later, so only resolving materialization indexes the definitions.
  const context = createContext(
    file,
    syntax,
    limits,
    options,
    options.keepReferences === true ? undefined : collectIndexes(blocks),
  );

  const children: FlowContent[] = [];
  const materializedBlocks: MaterializedBlock[] = [];

  for (const block of blocks) {
    const before = context.nodes;
    const child = materializeBlock(block, context);

    if (child !== undefined) {
      children.push(child);
      materializedBlocks.push(Object.freeze({ node: child, nodeCount: context.nodes - before }));
    }
  }

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

  if (
    context.authoredInvalid ||
    diagnostics.some((diagnostic) => diagnostic.severity === "error")
  ) {
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
    origin: range(0, file.length),
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

export interface MaterializedPhrasing {
  readonly nodes: readonly PhrasingContent[];
  readonly nodeCount: number;
}

/** Materialized phrasing by inline syntax identity, valid while references are kept. */
export type PhrasingCache = WeakMap<InlineSyntax, MaterializedPhrasing>;

/**
 * Materializes parsed inline syntax that a stream renders outside a block,
 * keeping references. Nodes found in `cache` keep their identity.
 */
export function materializePhrasing(
  file: SourceFile,
  nodes: readonly InlineSyntax[],
  syntax: ResolvedSyntaxOptions,
  limits: ResolvedParserLimits,
  cache?: PhrasingCache,
): MaterializedPhrasing {
  const context = createContext(file, syntax, limits, {
    keepReferences: true,
    allowIncomplete: true,
  });

  const children: PhrasingContent[] = [];
  let nodeCount = 0;

  for (const node of nodes) {
    let materialized = cache?.get(node);

    if (materialized === undefined) {
      const before = context.nodes;
      materialized = {
        nodes: materializeInlineNode(node, context),
        nodeCount: context.nodes - before,
      };

      if (context.limit === undefined && !context.usedEndOfInput) {
        cache?.set(node, materialized);
      }
    }

    children.push(...materialized.nodes);
    nodeCount += materialized.nodeCount;
  }

  return { nodes: children, nodeCount };
}

/** Only whitespace and at most one line ending follow `offset`. */
function reachesEndOfInput(file: SourceFile, offset: number): boolean {
  return /^[ \t]*(?:\r\n?|\n)?[ \t]*$/u.test(file.slice({ start: offset, end: file.length }));
}

function createContext(
  file: SourceFile,
  syntax: ResolvedSyntaxOptions,
  limits: ResolvedParserLimits,
  options: MaterializeOptions,
  indexes: DependencyIndexes = { definitions: new Set(), footnotes: new Set() },
): MaterializeContext {
  return {
    definitions: indexes.definitions,
    diagnostics: new DiagnosticBag(),
    file,
    footnotes: indexes.footnotes,
    limits,
    syntax,
    // Resolution depends on the definitions, so only reference-keeping output is cached.
    cache: options.keepReferences === true ? options.cache : undefined,
    grammarSource: undefined,
    maximumDepth: 0,
    usedEndOfInput: false,
    allowIncomplete: options.allowIncomplete ?? false,
    keepReferences: options.keepReferences ?? false,
    open: options.open,
    depth: 0,
    nodes: 0,
    authoredInvalid: false,
    limit: undefined,
  };
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

    return hit.node;
  }

  const nodes = context.nodes;
  const diagnostics = context.diagnostics.size;
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

    if (isOpenLeaf(block, context)) {
      context.usedEndOfInput = true;

      return counted(context, openLeafPlaceholder(block, origin));
    }

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
          children: materializeListItems(block, context),
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
        if (
          context.allowIncomplete &&
          block.state === "incomplete" &&
          reachesEndOfInput(context.file, block.range.end)
        ) {
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

function isOpenLeaf(block: BlockSyntax, context: MaterializeContext): boolean {
  return (
    context.open !== undefined &&
    block.range.start === context.open.start &&
    block.range.end === context.open.end &&
    (block.kind === "paragraph" ||
      block.kind === "code" ||
      block.kind === "math" ||
      block.kind === "invalidMdx")
  );
}

function openLeafPlaceholder(block: BlockSyntax, origin: SourceRange): FlowContent {
  switch (block.kind) {
    case "paragraph":
      return { kind: "paragraph", children: [], origin };
    case "code":
      return { kind: "codeBlock", value: "", origin };
    case "math":
      return { kind: "displayMath", value: "", format: "dollar", origin };
    default:
      return { kind: "rawHtmlBlock", value: "", origin };
  }
}

/**
 * Materializes list items. A growing list reuses its unchanged leading items
 * as one prefix, so an append materializes only the items after it. The list
 * that contains a stream's open leaf is rebuilt on every append and never
 * cached, so its children array is extended in place instead of copied.
 */
function materializeListItems(list: ListSyntax, context: MaterializeContext): ListItemNode[] {
  const items = list.items;
  const closing = list.closing ?? [];
  const count = items.length + closing.length;
  const itemAt = (index: number): ListItemSyntax => items[index] ?? closing[index - items.length];
  const open = context.open !== undefined && containsRange(list.range, context.open);
  const cache = context.cache;
  const prefix = cache === undefined ? undefined : listPrefix(count, itemAt, cache.lists);

  const reused =
    prefix !== undefined &&
    context.depth + prefix.depth <= context.limits.maximumNestingDepth &&
    context.nodes + prefix.nodeCount <= context.limits.maximumNodes
      ? prefix
      : undefined;

  let children: ListItemNode[] = [];

  if (reused !== undefined && reused.live && open) {
    children = reused.nodes;
    children.length = reused.length;
  } else if (reused !== undefined) {
    children = reused.nodes.slice(0, reused.length);
  }

  let nodeCount = reused?.nodeCount ?? 0;
  let depth = reused?.depth ?? 0;
  let cacheable = true;

  if (reused !== undefined) {
    context.nodes += reused.nodeCount;
    context.maximumDepth = Math.max(context.maximumDepth, context.depth + reused.depth);
  }

  for (let index = (reused?.index ?? -1) + 1; index < count; index++) {
    const item = itemAt(index);

    const node = cached(cache?.items, item, context, (): ListItemNode => ({
      kind: "listItem",
      checked: item.checked,
      spread: item.spread,
      children: materializeBlocks(item.children, context),
      origin: range(item.range.start, item.range.end),
    }));

    if (node !== undefined) {
      children.push(node);
    }

    // Items with diagnostics or end-of-input leniency are not cached, so prefixes stop there.
    const entry = cache?.items.get(item);
    cacheable &&= entry?.node === node;
    nodeCount += entry?.nodeCount ?? 0;
    depth = Math.max(depth, entry?.depth ?? 0);

    // A prefix is the first \`length\` nodes of \`children\`, which only ever grows past them.
    if (cacheable && index >= count - prefixWindow) {
      cache?.lists.set(item, {
        index,
        nodes: children,
        length: children.length,
        live: open,
        nodeCount,
        depth,
      });
    }
  }

  return children;
}

/**
 * How far back a list prefix can end. The parser closes an item only when the
 * next line completes, so the last two items are rebuilt by each tail draft.
 */
const prefixWindow = 8;

/** The cached prefix ending closest to the end of the list. Closing items can still change. */
function listPrefix(
  count: number,
  itemAt: (index: number) => ListItemSyntax,
  lists: MaterializeCache["lists"],
): CachedListPrefix | undefined {
  for (let index = count - 1; index >= Math.max(0, count - prefixWindow); index--) {
    const prefix = lists.get(itemAt(index));

    if (prefix?.index === index) {
      return prefix;
    }
  }

  return undefined;
}

function containsRange(outer: SourceRange, inner: SourceRange): boolean {
  return outer.start <= inner.start && inner.end <= outer.end;
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

  for (const invalid of result.invalid) {
    // Streaming input can still close a construct that reaches the end of the source.
    if (
      context.allowIncomplete &&
      invalid.open &&
      reachesEndOfInput(context.file, invalid.range.end)
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
      if (!context.keepReferences && !context.definitions.has(node.identifier)) {
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
      return context.keepReferences || context.footnotes.has(node.identifier)
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
    !isFlowJsxChildren(context.file, children)
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

function grammarSource(context: MaterializeContext): SourceText {
  context.grammarSource ??= sourceText(context.file).grammar();

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
      [...block.items, ...(block.closing ?? [])].forEach((item) => item.children.forEach(visit));
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
    span: span(file, 0, file.length),
  });
}
