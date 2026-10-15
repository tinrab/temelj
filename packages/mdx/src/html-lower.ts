import { isFunction } from "@temelj/value";

import type { FootnoteOccurrence } from "./footnote-numbering.ts";
import type {
  HtmlAttributes,
  HtmlElementNode,
  HtmlFootnoteSectionNode,
  HtmlNode,
  HtmlRootNode,
  HtmlTextNode,
  HtmlUnresolvedReferenceNode,
} from "./html.ts";
import type {
  ContainerDirectiveNode,
  DirectiveAttribute,
  DefinitionNode,
  DocumentNode,
  FootnoteDefinitionNode,
  FootnoteReferenceNode,
  ImageReferenceNode,
  LeafDirectiveNode,
  LinkReferenceNode,
  ListItemNode,
  ListNode,
  MdxNode,
  SourceRange,
  TableAlignment,
  TableNode,
  TableRowNode,
  TextDirectiveNode,
} from "./model.ts";
import type { SourceFile } from "./source.ts";

import { FootnoteNumbering } from "./footnote-numbering.ts";
import { formatMdx } from "./format.ts";
import { indexDocument, mdxChildren } from "./model.ts";
import { isUrlControlCharacter, normalizeUri } from "./uri.ts";

export interface HtmlRenderOptions {
  readonly allowUnsafeUrls?: boolean;
  readonly clobberPrefix?: string;
  readonly footnoteBackLabel?:
    | string
    | ((referenceIndex: number, rereferenceIndex: number) => string);
  readonly footnoteLabel?: string;
  readonly footnoteLabelTagName?: string;
  /** The file that node origins refer to. Inert fallbacks then keep authored text. */
  readonly source?: SourceFile;
  /**
   * Rewrites link and image URLs. `sanitized` is the default policy result, or
   * `undefined` when the default removes the URL; returning `undefined` removes it.
   */
  readonly urlTransform?: (
    url: string,
    kind: "image" | "link",
    sanitized: string | undefined,
  ) => string | undefined;
}

/**
 * Lowered HTML by node identity, separately for tight and loose list context. A
 * cache is valid while link definitions are unchanged. Subtrees that depend on
 * footnote numbering or a replacement are never cached.
 */
export interface HtmlLoweringCache {
  readonly loose: WeakMap<MdxNode, LoweredHtml>;
  readonly tight: WeakMap<MdxNode, LoweredHtml>;
  /** A growing list's lowered children, by the item they end with. */
  readonly lists: WeakMap<ListItemNode, ListPrefix>;
}

/** The wrapped children of a list's first `index + 1` items. */
interface ListPrefix {
  readonly index: number;
  readonly loose: boolean;
  readonly spread: boolean;
  readonly tasks: boolean;
  readonly children: SequencePrefix;
}

export function createHtmlLoweringCache(): HtmlLoweringCache {
  return { loose: new WeakMap(), tight: new WeakMap(), lists: new WeakMap() };
}

/**
 * What lowering resolves against. Batch lowering derives a scope from one
 * document; a stream assembles one from its settled blocks and open tail.
 */
export interface LoweringScope {
  readonly definition: (identifier: string) => DefinitionNode | undefined;
  readonly footnote: (identifier: string) => FootnoteDefinitionNode | undefined;
  readonly options: HtmlRenderOptions;
  /** The numbering of a reference to a defined footnote. */
  readonly occurrence: (node: FootnoteReferenceNode) => FootnoteOccurrence | undefined;
  /** Missing references lower to `unresolvedReference` nodes instead of authored text. */
  readonly provisional?: boolean;
  readonly cache?: HtmlLoweringCache;
  /** Lowers one node differently, such as the open leaf of a stream. */
  readonly replace?: (node: MdxNode) => readonly HtmlNode[] | undefined;
}

interface HtmlLoweringContext {
  readonly scope: LoweringScope;
  readonly listLoose: boolean;
  /** Counts lowered nodes whose output must not be cached. */
  readonly volatile: { count: number };
}

type LoweredHtml = HtmlNode | readonly HtmlNode[] | undefined;

const percentEncodedByteLength = 2;

const hexadecimalRadix = 16;

const percentEncodedByte = /^[0-9A-Fa-f]{2}$/u;

const linkSchemes = new Set(["http", "https", "irc", "ircs", "mailto", "xmpp"]);

const imageSchemes = new Set(["http", "https"]);

export function lowerHtml(document: DocumentNode, options: HtmlRenderOptions = {}): HtmlRootNode {
  const index = indexDocument(document);
  const numbering = new FootnoteNumbering();
  const occurrences = new Map<FootnoteReferenceNode, FootnoteOccurrence>();

  for (const reference of footnoteReferences(document)) {
    if (index.footnotes.has(reference.identifier)) {
      occurrences.set(reference, numbering.reference(reference.identifier));
    }
  }

  const scope: LoweringScope = {
    definition: (identifier) => index.definitions.get(identifier),
    footnote: (identifier) => index.footnotes.get(identifier),
    options,
    occurrence: (node) => occurrences.get(node),
  };

  const children = lowerNodes(document.children, scope);
  const footnotes = lowerFootnoteSection(numbering, scope);

  if (footnotes !== undefined) {
    children.push(footnotes);
  }

  return { kind: "root", children: joinBlocks(children), origin: document.origin };
}

/**
 * Lowers sibling nodes in one scope. `previous` is the sibling before them,
 * because text after a hard break drops its leading spaces.
 */
export function lowerNodes(
  nodes: readonly MdxNode[],
  scope: LoweringScope,
  previous?: MdxNode,
): HtmlNode[] {
  return lowerChildren(nodes, { scope, listLoose: false, volatile: { count: 0 } }, previous);
}

/** Separates top-level blocks with line endings, like a document root. */
export function joinBlocks(nodes: readonly HtmlNode[]): HtmlNode[] {
  return wrap(nodes, false);
}

/** Footnote reference nodes in document order. */
export function footnoteReferences(node: MdxNode): FootnoteReferenceNode[] {
  const result: FootnoteReferenceNode[] = [];

  const visit = (current: MdxNode): void => {
    if (current.kind === "footnoteReference") {
      result.push(current);
    }

    mdxChildren(current).forEach(visit);
  };

  visit(node);

  return result;
}

function lowerHtmlNode(node: MdxNode, context: HtmlLoweringContext): LoweredHtml {
  const replaced = context.scope.replace?.(node);

  if (replaced !== undefined) {
    context.volatile.count++;

    return replaced;
  }

  const cache = context.listLoose ? context.scope.cache?.loose : context.scope.cache?.tight;

  if (cache?.has(node) === true) {
    return cache.get(node);
  }

  const volatile = context.volatile.count;
  const lowered = lowerHtmlNodeCore(node, context);

  const result =
    lowered === undefined || node.origin === undefined
      ? lowered
      : isHtmlNodeArray(lowered)
        ? lowered.map((item) => withOrigin(item, node.origin))
        : withOrigin(lowered, node.origin);

  if (context.volatile.count === volatile) {
    cache?.set(node, result);
  }

  return result;
}

function isHtmlNodeArray(value: HtmlNode | readonly HtmlNode[]): value is readonly HtmlNode[] {
  return Array.isArray(value);
}

function withOrigin(node: HtmlNode, origin: SourceRange | undefined): HtmlNode {
  return origin === undefined || node.origin !== undefined ? node : { ...node, origin };
}

/** Authored source when the file is known, otherwise canonical MDX. */
function authored(node: MdxNode, context: HtmlLoweringContext): string {
  const source = context.scope.options.source;

  return source !== undefined && node.origin !== undefined
    ? source.slice(node.origin)
    : formatMdx(node);
}

function lowerHtmlNodeCore(node: MdxNode, context: HtmlLoweringContext): LoweredHtml {
  switch (node.kind) {
    case "text":
      return text(node.value);
    case "emphasis":
      return htmlElement("em", node.children, context);
    case "strong":
      return htmlElement("strong", node.children, context);
    case "delete":
      return htmlElement("del", node.children, context);
    case "directiveLabel":
      return lowerChildren(node.children, context);
    case "textDirective":
      return lowerTextDirective(node, context);
    case "inlineCode":
      return element("code", {}, [text(node.value.replace(/\r\n?|\n/gu, " "))]);
    case "inlineMath":
      return { kind: "math", source: node.value.replace(/\r\n?|\n/gu, " "), style: "inline" };
    case "hardBreak":
      return [element("br"), text("\n")];
    case "link":
      return lowerLink(node.url, node.title, node.children, context);
    case "linkReference": {
      const definition = context.scope.definition(node.identifier);

      if (definition !== undefined) {
        return lowerLink(definition.url, definition.title, node.children, context);
      }

      return context.scope.provisional === true
        ? unresolvedReference("link", node, lowerChildren(node.children, context), context)
        : revertReference(node, context);
    }

    case "image":
      return lowerImage(node.url, node.alt, node.title, context);
    case "imageReference": {
      const definition = context.scope.definition(node.identifier);

      if (definition !== undefined) {
        return lowerImage(definition.url, node.alt, definition.title, context);
      }

      return context.scope.provisional === true
        ? unresolvedReference("image", node, [text(node.alt)], context)
        : text(formatMdx(node));
    }

    case "footnoteReference": {
      context.volatile.count++;
      const occurrence = context.scope.occurrence(node);

      if (occurrence !== undefined) {
        return lowerFootnoteReference(node, occurrence, context.scope.options);
      }

      return context.scope.provisional === true
        ? unresolvedReference("footnote", node, [], context)
        : text(formatMdx(node));
    }

    case "definition":
    case "footnoteDefinition":
    case "frontmatter":
    case "esm":
      return undefined;
    case "leafDirective":
      return lowerLeafDirective(node, context);
    case "containerDirective":
      return lowerContainerDirective(node, context);
    case "rawHtmlBlock":
    case "rawHtmlInline":
      return { kind: "raw", value: node.value };
    case "inlineExpression":
    case "blockExpression":
      return { kind: "expression", code: node.code, fallback: authored(node, context) };
    case "jsxTextElement":
    case "jsxFlowElement":
      return {
        kind: "jsx",
        state: "complete",
        element: node.kind === "jsxFlowElement" ? "flow" : "text",
        name: node.name,
        attributes: node.attributes,
        fallback: authored(node, context),
        children: lowerChildren(node.children, context),
      };
    case "paragraph":
      // Like MDX, a paragraph of only JSX and expressions does not produce a `p`.
      return node.children.every(isEmbeddedPhrasing) &&
        node.children.some((child) => child.kind !== "text")
        ? lowerChildren(node.children, context)
        : htmlElement("p", node.children, context);
    case "heading":
      return htmlElement(`h${node.depth}`, node.children, context);
    case "codeBlock": {
      const language = node.language?.trim().split(/\s+/u)[0];

      return language === undefined || language.length === 0
        ? element("pre", {}, [
            element("code", {}, [text(node.value.length === 0 ? "" : `${node.value}\n`)]),
          ])
        : { kind: "codeBlock", code: node.value, language, meta: node.meta };
    }

    case "displayMath":
      return { kind: "math", source: node.value, style: "display", meta: node.meta };
    case "thematicBreak":
      return element("hr");
    case "list":
      return lowerList(node, context);
    case "listItem":
      return lowerListItem(node, context);
    case "table":
      return lowerTable(node, context);
    case "tableRow":
      return lowerTableRow(node, undefined, false, context);
    case "tableCell":
      return htmlElement("td", node.children, context);
    case "blockquote":
      return element("blockquote", {}, wrap(lowerChildren(node.children, context), true));
    case "document":
      return wrap(lowerChildren(node.children, context), false);
    default: {
      const exhaustive: never = node;

      return exhaustive;
    }
  }
}

function isEmbeddedPhrasing(node: MdxNode): boolean {
  return (
    node.kind === "jsxTextElement" ||
    node.kind === "inlineExpression" ||
    (node.kind === "text" && node.value.trim() === "")
  );
}

function lowerTextDirective(
  node: TextDirectiveNode,
  context: HtmlLoweringContext,
): HtmlElementNode {
  return element(
    "span",
    directiveHtmlAttributes(node.name, "text", node.attributes),
    node.label === undefined ? [] : lowerChildren(node.label.children, context),
  );
}

function lowerLeafDirective(
  node: LeafDirectiveNode,
  context: HtmlLoweringContext,
): HtmlElementNode {
  return element(
    "div",
    directiveHtmlAttributes(node.name, "leaf", node.attributes),
    node.label === undefined ? [] : [directiveLabel(node, context)],
  );
}

function lowerContainerDirective(
  node: ContainerDirectiveNode,
  context: HtmlLoweringContext,
): HtmlElementNode {
  const children: HtmlNode[] = [];

  if (node.label !== undefined) {
    children.push(directiveLabel(node, context));
  }

  children.push(...lowerChildren(node.children, context));

  return element(
    "div",
    directiveHtmlAttributes(node.name, "container", node.attributes),
    wrap(children, true),
  );
}

function directiveLabel(
  node: LeafDirectiveNode | ContainerDirectiveNode,
  context: HtmlLoweringContext,
): HtmlElementNode {
  return element(
    "span",
    { "data-directive-label": "" },
    lowerChildren(node.label?.children ?? [], context),
  );
}

function directiveHtmlAttributes(
  name: string,
  kind: "container" | "leaf" | "text",
  entries: readonly DirectiveAttribute[],
): HtmlAttributes {
  const attributes = { "data-directive": name, "data-directive-kind": kind };

  return entries.length === 0
    ? attributes
    : {
        ...attributes,
        "data-directive-attributes": JSON.stringify(
          entries.map((entry) => [entry.name, entry.value]),
        ),
      };
}

function unresolvedReference(
  reference: HtmlUnresolvedReferenceNode["reference"],
  node: LinkReferenceNode | ImageReferenceNode | FootnoteReferenceNode,
  children: readonly HtmlNode[],
  context: HtmlLoweringContext,
): HtmlUnresolvedReferenceNode {
  return {
    kind: "unresolvedReference",
    reference,
    identifier: node.identifier,
    source: authored(node, context),
    children,
  };
}

function lowerFootnoteReference(
  node: FootnoteReferenceNode,
  occurrence: FootnoteOccurrence,
  options: HtmlRenderOptions,
): HtmlNode {
  const prefix = options.clobberPrefix ?? "user-content-";
  const identifier = normalizeUri(node.identifier.toLowerCase());
  const suffix = occurrence.occurrence > 1 ? `-${occurrence.occurrence}` : "";

  return {
    kind: "footnoteReference",
    identifier: node.identifier,
    occurrence: occurrence.occurrence,
    ordinal: occurrence.ordinal,
    children: [
      element(
        "a",
        {
          href: `#${prefix}fn-${identifier}`,
          id: `${prefix}fnref-${identifier}${suffix}`,
          "data-footnote-ref": "",
          "aria-describedby": "footnote-label",
        },
        [text(String(occurrence.ordinal))],
      ),
    ],
  };
}

/** The generated section for the numbered footnotes, or `undefined` when none is referenced. */
export function lowerFootnoteSection(
  numbering: FootnoteNumbering,
  scope: LoweringScope,
): HtmlFootnoteSectionNode | undefined {
  const order = numbering.order;

  if (order.length === 0) {
    return undefined;
  }

  const context: HtmlLoweringContext = { scope, listLoose: false, volatile: { count: 0 } };
  const prefix = scope.options.clobberPrefix ?? "user-content-";
  const items: HtmlElementNode[] = [];

  for (let index = 0; index < order.length; index++) {
    const identifier = order[index];
    const definition = scope.footnote(identifier);

    if (definition === undefined) {
      continue;
    }

    const safeIdentifier = normalizeUri(identifier.toLowerCase());
    const blocks = lowerChildren(definition.children, context);

    const backreferences = footnoteBackreferences(
      safeIdentifier,
      index,
      numbering.count(identifier),
      prefix,
      scope.options,
    );

    const tail = blocks.at(-1);

    if (tail?.kind === "element" && tail.tagName === "p") {
      blocks[blocks.length - 1] = {
        ...tail,
        children: [
          ...tail.children,
          ...(tail.children.length === 0 ? [] : [text(" ")]),
          ...backreferences,
        ],
      };
    } else {
      if (blocks.length > 0) {
        blocks.push(text("\n"));
      }

      blocks.push(...backreferences);
    }

    items.push(element("li", { id: `${prefix}fn-${safeIdentifier}` }, wrap(blocks, true)));
  }

  const heading = element(
    scope.options.footnoteLabelTagName ?? "h2",
    { id: "footnote-label", class: ["sr-only"] },
    [text(scope.options.footnoteLabel ?? "Footnotes")],
  );

  return {
    kind: "footnoteSection",
    identifiers: [...order],
    children: wrap([heading, element("ol", {}, wrap(items, true))], true),
  };
}

function footnoteBackreferences(
  identifier: string,
  referenceIndex: number,
  count: number,
  prefix: string,
  options: HtmlRenderOptions,
): HtmlNode[] {
  const values: HtmlNode[] = [];

  for (let reuse = 1; reuse <= count; reuse++) {
    if (values.length > 0) {
      values.push(text(" "));
    }

    const configured = options.footnoteBackLabel;

    const label = isFunction(configured)
      ? configured(referenceIndex, reuse)
      : (configured ?? defaultFootnoteBackLabel(referenceIndex, reuse));

    values.push(
      element(
        "a",
        {
          href: `#${prefix}fnref-${identifier}${reuse > 1 ? `-${reuse}` : ""}`,
          "data-footnote-backref": "",
          "aria-label": label,
          class: ["data-footnote-backref"],
        },
        [text("↩"), ...(reuse > 1 ? [element("sup", {}, [text(String(reuse))])] : [])],
      ),
    );
  }

  return values;
}

function defaultFootnoteBackLabel(referenceIndex: number, reuse: number): string {
  return `Back to reference ${referenceIndex + 1}${reuse > 1 ? `-${reuse}` : ""}`;
}

function lowerTable(node: TableNode, context: HtmlLoweringContext): HtmlElementNode {
  const head = node.children[0];
  const children: HtmlNode[] = [];

  if (head !== undefined) {
    children.push(element("thead", {}, [lowerTableRow(head, node.alignments, true, context)]));
  }

  if (node.children.length > 1) {
    children.push(
      element(
        "tbody",
        {},
        node.children.slice(1).map((row) => lowerTableRow(row, node.alignments, false, context)),
      ),
    );
  }

  return element("table", {}, children);
}

function lowerTableRow(
  node: TableRowNode,
  alignments: readonly TableAlignment[] | undefined,
  heading: boolean,
  context: HtmlLoweringContext,
): HtmlElementNode {
  const length = alignments?.length ?? node.children.length;
  const cells: HtmlElementNode[] = [];

  for (let index = 0; index < length; index++) {
    const cell = node.children.at(index);
    const alignment = alignments?.[index];
    cells.push(
      element(
        heading ? "th" : "td",
        alignment === undefined || alignment === "none" ? {} : { align: alignment },
        cell === undefined ? [] : lowerChildren(cell.children, context),
      ),
    );
  }

  return element("tr", {}, cells);
}

function lowerLink(
  url: string,
  title: string | undefined,
  children: readonly MdxNode[],
  context: HtmlLoweringContext,
): HtmlElementNode {
  const href = resolveUrl(url, "link", context.scope.options);

  const attributes: HtmlAttributes =
    href === undefined ? {} : title === undefined ? { href } : { href, title };

  return element("a", attributes, lowerChildren(children, context));
}

function lowerImage(
  source: string,
  alt: string,
  title: string | undefined,
  context: HtmlLoweringContext,
): HtmlNode {
  const src = resolveUrl(source, "image", context.scope.options);

  if (src === undefined) {
    return text(alt);
  }

  return element("img", title === undefined ? { src, alt } : { src, alt, title });
}

/**
 * A list wraps its items in line endings. A growing list reuses the wrapped
 * children of its unchanged leading items, so an append lowers only new items.
 * Stream previews build long children from fixed fragments, so extending them
 * copies only the fragment list; strict output stays flat.
 */
function lowerList(node: ListNode, context: HtmlLoweringContext): HtmlElementNode {
  const items = node.children;
  const prefix = listPrefix(items, context.scope.cache);
  const rest = items.slice((prefix?.index ?? -1) + 1);
  const spread = (prefix?.spread ?? false) || rest.some((item) => item.spread);
  const loose = node.spread || spread;
  const tasks = (prefix?.tasks ?? false) || rest.some((item) => item.checked !== undefined);
  const reused = prefix !== undefined && prefix.loose === loose ? prefix : undefined;
  const itemContext: HtmlLoweringContext = { ...context, listLoose: loose };
  const children = new ChildSequence(context.scope.provisional === true, reused?.children);

  if (reused === undefined) {
    children.push(newline);
  }

  let stable = true;
  let spreadSoFar = reused?.spread ?? false;
  let tasksSoFar = reused?.tasks ?? false;

  for (let index = (reused?.index ?? -1) + 1; index < items.length; index++) {
    spreadSoFar ||= items[index].spread;
    tasksSoFar ||= items[index].checked !== undefined;
    const volatile = context.volatile.count;
    const lowered = lowerHtmlNode(items[index], itemContext);

    for (const item of lowered === undefined
      ? []
      : isHtmlNodeArray(lowered)
        ? lowered
        : [lowered]) {
      if (children.size > 1) {
        children.push(newline);
      }

      children.push(item);
    }

    stable &&= context.volatile.count === volatile;

    // The last items can still close differently, so prefixes ending a few items back are kept.
    if (stable && index >= items.length - prefixWindow) {
      context.scope.cache?.lists.set(items[index], {
        index,
        loose,
        spread: spreadSoFar,
        tasks: tasksSoFar,
        children: children.prefix(),
      });
    }
  }

  const attributes: Record<string, number | readonly string[]> = {};

  if (node.ordered && node.start !== 1) {
    attributes.start = node.start;
  }

  if (tasks) {
    attributes.class = ["contains-task-list"];
  }

  if (children.size > 1) {
    children.push(newline);
  }

  return element(node.ordered ? "ol" : "ul", attributes, children.toArray());
}

/**
 * How far back a list prefix can end. The parser closes an item only when the
 * next line completes, so the last two items are rebuilt by each tail draft.
 */
const prefixWindow = 8;

/** Children of a long sequence in fragments of this many nodes. */
const fragmentSize = 64;

/** A prefix of a child sequence: full fragments, then the nodes after them. */
interface SequencePrefix {
  readonly fragments: readonly HtmlRootNode[];
  readonly rest: readonly HtmlNode[];
  readonly size: number;
}

/**
 * Children that grow at the end. With fragments, full groups of nodes become
 * frozen fragments that later prefixes share, so copying a prefix costs only
 * the fragment list and the partial group.
 */
class ChildSequence {
  readonly #fragmented: boolean;
  readonly #fragments: HtmlRootNode[];
  #rest: HtmlNode[];
  #size: number;

  public constructor(fragmented: boolean, prefix?: SequencePrefix) {
    this.#fragmented = fragmented;
    this.#fragments = prefix === undefined ? [] : [...prefix.fragments];
    this.#rest = prefix === undefined ? [] : [...prefix.rest];
    this.#size = prefix?.size ?? 0;
  }

  public get size(): number {
    return this.#size;
  }

  public push(node: HtmlNode): void {
    this.#rest.push(node);
    this.#size++;

    if (this.#fragmented && this.#rest.length === fragmentSize) {
      this.#fragments.push(Object.freeze({ kind: "root", children: this.#rest }));
      this.#rest = [];
    }
  }

  public prefix(): SequencePrefix {
    return { fragments: [...this.#fragments], rest: [...this.#rest], size: this.#size };
  }

  /** A short sequence stays flat, so fragments appear only where they save copying. */
  public toArray(): HtmlNode[] {
    if (this.#fragments.length < 2) {
      return [...this.#fragments.flatMap((fragment) => fragment.children), ...this.#rest];
    }

    return [...this.#fragments, ...this.#rest];
  }
}

/** The longest cached prefix of `items`, found from the end. */
function listPrefix(
  items: readonly ListItemNode[],
  cache: HtmlLoweringCache | undefined,
): ListPrefix | undefined {
  for (let index = items.length - 1; index >= Math.max(0, items.length - prefixWindow); index--) {
    const item = items[index];
    const prefix = item === undefined ? undefined : cache?.lists.get(item);

    if (prefix?.index === index) {
      return prefix;
    }
  }

  return undefined;
}

function lowerListItem(node: ListItemNode, context: HtmlLoweringContext): HtmlElementNode {
  const blocks = [...lowerChildren(node.children, context)];

  if (node.checked !== undefined) {
    const checkbox = element(
      "input",
      node.checked
        ? { type: "checkbox", disabled: true, checked: true }
        : { type: "checkbox", disabled: true },
    );

    const first = blocks[0];

    if (first?.kind === "element" && first.tagName === "p") {
      blocks[0] = {
        ...first,
        children: [
          checkbox,
          ...(first.children.length === 0 ? [] : [text(" ")]),
          ...first.children,
        ],
      };
    } else {
      blocks.unshift(element("p", {}, [checkbox]));
    }
  }

  const children: HtmlNode[] = [];

  for (let index = 0; index < blocks.length; index++) {
    const child = blocks[index];
    const paragraph = child.kind === "element" && child.tagName === "p";

    if (context.listLoose || index !== 0 || !paragraph) {
      children.push(text("\n"));
    }

    if (paragraph && !context.listLoose) {
      children.push(...child.children);
    } else {
      children.push(child);
    }
  }

  const tail = blocks.at(-1);

  if (
    tail !== undefined &&
    (context.listLoose || tail.kind !== "element" || tail.tagName !== "p")
  ) {
    children.push(text("\n"));
  }

  return element("li", node.checked === undefined ? {} : { class: ["task-list-item"] }, children);
}

function revertReference(
  node: LinkReferenceNode,
  context: HtmlLoweringContext,
): readonly HtmlNode[] {
  const children = lowerChildren(node.children, context);

  const suffix =
    node.referenceKind === "shortcut"
      ? "]"
      : node.referenceKind === "collapsed"
        ? "][]"
        : `][${node.identifier}]`;

  if (children.length === 0) {
    return [text(`[${suffix}`)];
  }

  const first = children[0];

  const result: HtmlNode[] =
    first.kind === "text"
      ? [text(`[${first.value}`), ...children.slice(1)]
      : [text("["), ...children];

  const last = result[result.length - 1];

  if (last.kind === "text") {
    result[result.length - 1] = text(last.value + suffix);
  } else {
    result.push(text(suffix));
  }

  return result;
}

function lowerChildren(
  children: readonly MdxNode[],
  context: HtmlLoweringContext,
  previous?: MdxNode,
): HtmlNode[] {
  const values: HtmlNode[] = [];

  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    const lowered = lowerHtmlNode(child, context);

    if (lowered === undefined) {
      continue;
    }

    const additions = isHtmlNodeArray(lowered) ? [...lowered] : [lowered];
    const before = index === 0 ? previous : children[index - 1];

    if (before?.kind === "hardBreak" && additions.length > 0) {
      additions[0] = trimSpaceStart(additions[0]);
    }

    values.push(...additions);
  }

  return values;
}

function htmlElement(
  tagName: string,
  children: readonly MdxNode[],
  context: HtmlLoweringContext,
): HtmlElementNode {
  return element(tagName, {}, lowerChildren(children, context));
}

function element(
  tagName: string,
  attributes: HtmlAttributes = {},
  children: readonly HtmlNode[] = [],
): HtmlElementNode {
  return { kind: "element", tagName, attributes, children };
}

function text(value: string): HtmlTextNode {
  return { kind: "text", value };
}

function trimSpaceStart(node: HtmlNode): HtmlNode {
  if (node.kind === "text") {
    return { ...node, value: node.value.replace(/^[\t ]+/u, "") };
  }

  if (node.kind === "element") {
    const first = node.children[0];

    if (first?.kind === "text") {
      return {
        ...node,
        children: [
          { ...first, value: first.value.replace(/^[\t ]+/u, "") },
          ...node.children.slice(1),
        ],
      };
    }
  }

  return node;
}

/** Line endings between blocks. Trees are immutable, so every separator shares one node. */
const newline: HtmlTextNode = Object.freeze({ kind: "text", value: "\n" });

function wrap(nodes: readonly HtmlNode[], loose: boolean): HtmlNode[] {
  const result: HtmlNode[] = [];

  if (loose) {
    result.push(newline);
  }

  nodes.forEach((node, index) => {
    if (index > 0) {
      result.push(newline);
    }

    result.push(node);
  });

  if (loose && nodes.length > 0) {
    result.push(newline);
  }

  return result;
}

function resolveUrl(
  url: string,
  kind: "image" | "link",
  options: HtmlRenderOptions,
): string | undefined {
  const sanitized = sanitizeUrl(url, options, kind);

  return options.urlTransform === undefined
    ? sanitized
    : options.urlTransform(url, kind, sanitized);
}

export function sanitizeUrl(
  value: string,
  options: HtmlRenderOptions,
  use: "image" | "link",
): string | undefined {
  const decoded = decodeUrlForSchemeCheck(value);
  const colon = decoded.indexOf(":");
  const slash = decoded.indexOf("/");
  const query = decoded.indexOf("?");
  const hash = decoded.indexOf("#");

  const hasScheme =
    colon >= 0 &&
    (slash < 0 || colon < slash) &&
    (query < 0 || colon < query) &&
    (hash < 0 || colon < hash);

  if (hasScheme && options.allowUnsafeUrls !== true) {
    const scheme = decoded.slice(0, colon).toLowerCase();

    if (use === "image" ? !imageSchemes.has(scheme) : !linkSchemes.has(scheme)) {
      return undefined;
    }
  }

  return normalizeUri(value);
}

function decodeUrlForSchemeCheck(value: string): string {
  const result: string[] = [];

  for (let index = 0; index < value.length; index++) {
    const character = value[index];

    const hexadecimal = value.slice(
      index + "%".length,
      index + "%".length + percentEncodedByteLength,
    );

    if (character === "%" && percentEncodedByte.test(hexadecimal)) {
      const decoded = String.fromCodePoint(Number.parseInt(hexadecimal, hexadecimalRadix));

      if (!isUrlControlCharacter(decoded)) {
        result.push(decoded);
      }

      index += hexadecimal.length;
      continue;
    }

    if (!isUrlControlCharacter(character)) {
      result.push(character);
    }
  }

  return result.join("");
}
