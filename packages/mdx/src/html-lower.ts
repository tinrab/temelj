import { isFunction } from "@temelj/value";

import type {
  HtmlAttributes,
  HtmlElementNode,
  HtmlFootnoteSectionNode,
  HtmlNode,
  HtmlRootNode,
  HtmlTextNode,
} from "./html.ts";
import type {
  ContainerDirectiveNode,
  DirectiveAttribute,
  DocumentIndex,
  DocumentNode,
  FootnoteReferenceNode,
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

import { formatMdx } from "./format.ts";
import { indexDocument, mdxChildren } from "./model.ts";
import { normalizeUri } from "./uri.ts";
import { isUrlControlCharacter } from "./utility.ts";

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

interface FootnoteReferenceInfo {
  readonly index: number;
  readonly reuse: number;
}

/**
 * Lowered HTML by node identity, separately for tight and loose list context. A
 * cache is valid while definitions and footnote numbering are unchanged.
 */
export interface HtmlLoweringCache {
  readonly loose: WeakMap<MdxNode, LoweredHtml>;
  readonly tight: WeakMap<MdxNode, LoweredHtml>;
}

interface HtmlLoweringContext {
  readonly cache: HtmlLoweringCache | undefined;
  readonly index: DocumentIndex;
  readonly footnoteReference: (node: FootnoteReferenceNode) => HtmlNode;
  readonly listLoose: boolean;
  readonly options: HtmlRenderOptions;
}

type LoweredHtml = HtmlNode | readonly HtmlNode[] | undefined;

export function createHtmlLoweringCache(): HtmlLoweringCache {
  return { loose: new WeakMap(), tight: new WeakMap() };
}

const percentEncodedByteLength = 2;

const hexadecimalRadix = 16;

const percentEncodedByte = /^[0-9A-Fa-f]{2}$/u;

const linkSchemes = new Set(["http", "https", "irc", "ircs", "mailto", "xmpp"]);

const imageSchemes = new Set(["http", "https"]);

export function lowerHtml(document: DocumentNode, options: HtmlRenderOptions = {}): HtmlRootNode {
  const renderer = createBlockHtmlRenderer(document, options);
  const children = renderer.render(document.children);
  const footnotes = renderer.footnotes();

  if (footnotes !== undefined) {
    children.push(footnotes);
  }

  return { kind: "root", children: wrap(children, false), origin: document.origin };
}

export interface BlockHtmlRenderer {
  readonly render: (nodes: readonly MdxNode[]) => HtmlNode[];
  readonly footnotes: () => HtmlFootnoteSectionNode | undefined;
  readonly referenceContext: (ranges: readonly SourceRange[]) => string;
}

/** Shares one document-wide footnote layout across separately rendered blocks. */
export function createBlockHtmlRenderer(
  document: DocumentNode,
  options: HtmlRenderOptions = {},
  referenceNodes: readonly FootnoteReferenceNode[] = footnoteReferences(document),
  cache?: HtmlLoweringCache,
): BlockHtmlRenderer {
  const index = indexDocument(document);
  const order: string[] = [];
  const indexes = new Map<string, number>();
  const counts = new Map<string, number>();
  const references = new Map<FootnoteReferenceNode, FootnoteReferenceInfo>();
  const referencesByRange = new Map<string, FootnoteReferenceInfo>();

  for (const reference of referenceNodes) {
    if (!index.footnotes.has(reference.identifier)) {
      continue;
    }

    let position = indexes.get(reference.identifier);

    if (position === undefined) {
      order.push(reference.identifier);
      position = order.length - 1;
      indexes.set(reference.identifier, position);
    }

    const reuse = (counts.get(reference.identifier) ?? 0) + 1;
    counts.set(reference.identifier, reuse);
    const info = { index: position, reuse };
    references.set(reference, info);

    if (reference.origin !== undefined) {
      referencesByRange.set(rangeKey(reference.origin), info);
    }
  }

  const context: HtmlLoweringContext = {
    cache,
    index,
    footnoteReference: (reference) =>
      lowerFootnoteReference(
        reference,
        references.get(reference) ??
          (reference.origin === undefined
            ? undefined
            : referencesByRange.get(rangeKey(reference.origin))),
        options,
      ),
    listLoose: false,
    options,
  };

  return {
    render: (nodes) => lowerChildren(nodes, context),
    footnotes: () => lowerFootnoteSection(order, counts, context),
    referenceContext: (ranges) =>
      JSON.stringify(ranges.map((range) => referencesByRange.get(rangeKey(range)))),
  };
}

function footnoteReferences(document: DocumentNode): FootnoteReferenceNode[] {
  const result: FootnoteReferenceNode[] = [];

  const visit = (node: MdxNode): void => {
    if (node.kind === "footnoteReference") {
      result.push(node);
    }

    mdxChildren(node).forEach(visit);
  };

  visit(document);

  return result;
}

function rangeKey(range: SourceRange): string {
  return `${range.start}:${range.end}`;
}

function lowerHtmlNode(node: MdxNode, context: HtmlLoweringContext): LoweredHtml {
  const cache = context.listLoose ? context.cache?.loose : context.cache?.tight;

  if (cache?.has(node) === true) {
    return cache.get(node);
  }

  const lowered = lowerHtmlNodeCore(node, context);

  const result =
    lowered === undefined || node.origin === undefined
      ? lowered
      : isHtmlNodeArray(lowered)
        ? lowered.map((item) => withOrigin(item, node.origin))
        : withOrigin(lowered, node.origin);

  cache?.set(node, result);

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
  const source = context.options.source;

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
      const definition = context.index.definitions.get(node.identifier);

      return definition === undefined
        ? revertReference(node, context)
        : lowerLink(definition.url, definition.title, node.children, context);
    }

    case "image":
      return lowerImage(node.url, node.alt, node.title, context);
    case "imageReference": {
      const definition = context.index.definitions.get(node.identifier);

      return definition === undefined
        ? text(formatMdx(node))
        : lowerImage(definition.url, node.alt, definition.title, context);
    }

    case "footnoteReference":
      return context.footnoteReference(node);
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
        node,
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

function lowerFootnoteReference(
  node: FootnoteReferenceNode,
  info: FootnoteReferenceInfo | undefined,
  options: HtmlRenderOptions,
): HtmlNode {
  if (info === undefined) {
    return text(formatMdx(node));
  }

  const prefix = options.clobberPrefix ?? "user-content-";
  const identifier = normalizeUri(node.identifier.toLowerCase());
  const suffix = info.reuse > 1 ? `-${info.reuse}` : "";

  return {
    kind: "footnoteReference",
    identifier: node.identifier,
    occurrence: info.reuse,
    ordinal: info.index + 1,
    children: [
      element(
        "a",
        {
          href: `#${prefix}fn-${identifier}`,
          id: `${prefix}fnref-${identifier}${suffix}`,
          "data-footnote-ref": "",
          "aria-describedby": "footnote-label",
        },
        [text(String(info.index + 1))],
      ),
    ],
  };
}

function lowerFootnoteSection(
  order: readonly string[],
  counts: ReadonlyMap<string, number>,
  context: HtmlLoweringContext,
): HtmlFootnoteSectionNode | undefined {
  if (order.length === 0) {
    return undefined;
  }

  const prefix = context.options.clobberPrefix ?? "user-content-";
  const items: HtmlElementNode[] = [];

  for (let index = 0; index < order.length; index++) {
    const identifier = order[index];
    const definition = context.index.footnotes.get(identifier);

    if (definition === undefined) {
      continue;
    }

    const safeIdentifier = normalizeUri(identifier.toLowerCase());
    const blocks = lowerChildren(definition.children, context);

    const backreferences = footnoteBackreferences(
      safeIdentifier,
      index,
      counts.get(identifier) ?? 1,
      prefix,
      context.options,
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
    context.options.footnoteLabelTagName ?? "h2",
    { id: "footnote-label", class: ["sr-only"] },
    [text(context.options.footnoteLabel ?? "Footnotes")],
  );

  return {
    kind: "footnoteSection",
    identifiers: order,
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
  const href = resolveUrl(url, "link", context.options);

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
  const src = resolveUrl(source, "image", context.options);

  if (src === undefined) {
    return text(alt);
  }

  return element("img", title === undefined ? { src, alt } : { src, alt, title });
}

function lowerList(node: ListNode, context: HtmlLoweringContext): HtmlElementNode {
  const loose = node.spread || node.children.some((item) => item.spread);
  const itemContext: HtmlLoweringContext = { ...context, listLoose: loose };
  const items = node.children.flatMap((item) => lowerHtmlNode(item, itemContext) ?? []);
  const attributes: Record<string, number | readonly string[]> = {};

  if (node.ordered && node.start !== 1) {
    attributes.start = node.start;
  }

  if (node.children.some((item) => item.checked !== undefined)) {
    attributes.class = ["contains-task-list"];
  }

  return element(node.ordered ? "ol" : "ul", attributes, wrap(items, true));
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

function lowerChildren(children: readonly MdxNode[], context: HtmlLoweringContext): HtmlNode[] {
  const values: HtmlNode[] = [];

  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    const lowered = lowerHtmlNode(child, context);

    if (lowered === undefined) {
      continue;
    }

    const additions = isHtmlNodeArray(lowered) ? [...lowered] : [lowered];

    if (children[index - 1]?.kind === "hardBreak" && additions.length > 0) {
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

function wrap(nodes: readonly HtmlNode[], loose: boolean): HtmlNode[] {
  const result: HtmlNode[] = [];

  if (loose) {
    result.push(text("\n"));
  }

  nodes.forEach((node, index) => {
    if (index > 0) {
      result.push(text("\n"));
    }

    result.push(node);
  });

  if (loose && nodes.length > 0) {
    result.push(text("\n"));
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
