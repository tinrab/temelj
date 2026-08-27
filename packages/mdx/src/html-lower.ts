import type {
  ContainerDirectiveNode,
  DefinitionNode,
  DocumentNode,
  FootnoteReferenceNode,
  LinkNode,
  LinkReferenceNode,
  LeafDirectiveNode,
  ListItemNode,
  ListNode,
  TableCellNode,
  TableNode,
  TableRowNode,
  TextDirectiveNode,
  MdxNode,
  SourceSpan,
  TableAlignment,
} from "./model.ts";

import {
  HtmlCodeBlockNode,
  HtmlCommentNode,
  HtmlDoctypeNode,
  HtmlDocumentNode,
  HtmlElementNode,
  HtmlFragmentNode,
  HtmlFootnoteReferenceNode,
  HtmlFootnoteSectionNode,
  HtmlJsxNode,
  HtmlMathNode,
  HtmlRawNode,
  HtmlTextNode,
  isHtmlNode,
  type HtmlAttributeValue,
  type HtmlNode,
} from "./html.ts";
import { selectTree } from "./tree.ts";
import { replacementCharacter } from "./utility.ts";

export interface HtmlRenderOptions {
  readonly allowUnsafeUrls?: boolean;
  readonly clobberPrefix?: string;
  readonly footnoteBackLabel?:
    | string
    | ((referenceIndex: number, rereferenceIndex: number) => string);
  readonly footnoteLabel?: string;
  readonly footnoteLabelTagName?: string;
}

interface FootnoteReferenceInfo {
  readonly index: number;
  readonly reuse: number;
}

interface HtmlLoweringContext {
  readonly definition: (identifier: string) => DefinitionNode | undefined;
  readonly footnoteReference: (node: FootnoteReferenceNode) => HtmlNode;
  readonly listLoose: boolean;
  readonly options: HtmlRenderOptions;
}

type LoweredHtml = HtmlNode | readonly HtmlNode[] | undefined;

const percentEncodedByteLength = 2;
const hexadecimalRadix = 16;
const deleteCharacter = "\u007F";
const percentEncodedByte = /^[0-9A-Fa-f]{2}$/u;
const loneSurrogate = /^[\uD800-\uDFFF]$/u;
const uriCharacters =
  "!#$&'()*+,-./0123456789:;=?@ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~";

const linkSchemes = new Set(["http", "https", "irc", "ircs", "mailto", "xmpp"]);
const imageSchemes = new Set(["http", "https"]);

export function renderHtml(
  document: DocumentNode,
  options: HtmlRenderOptions = {},
): HtmlDocumentNode {
  const order: string[] = [];
  const indexes = new Map<string, number>();
  const counts = new Map<string, number>();
  const references = new Map<FootnoteReferenceNode, FootnoteReferenceInfo>();
  for (const { node: reference } of selectTree<MdxNode, "footnoteReference">(
    document,
    "footnoteReference",
    (node) => node.children,
  )) {
    if (document.footnote(reference.identifier) === undefined) {
      continue;
    }
    let index = indexes.get(reference.identifier);
    if (index === undefined) {
      order.push(reference.identifier);
      index = order.length - 1;
      indexes.set(reference.identifier, index);
    }
    const reuse = (counts.get(reference.identifier) ?? 0) + 1;
    counts.set(reference.identifier, reuse);
    references.set(reference, { index, reuse });
  }
  const context: HtmlLoweringContext = {
    definition: (identifier) => document.definition(identifier),
    footnoteReference: (reference) =>
      lowerFootnoteReference(reference, references.get(reference), options),
    listLoose: false,
    options,
  };
  const children = lowerChildren(document.children, context);
  const footnotes = lowerFootnoteSection(document, order, counts, context);
  if (footnotes !== undefined) {
    children.push(footnotes);
  }
  return new HtmlDocumentNode(wrap(children, false), document.origin);
}

function lowerHtmlNode(node: MdxNode, context: HtmlLoweringContext): LoweredHtml {
  const result = lowerHtmlNodeCore(node, context);
  if (result === undefined) {
    return undefined;
  }
  if (isHtmlNode(result)) {
    return htmlNodeWithOrigin(result, node.origin);
  }
  return result.map((item) => htmlNodeWithOrigin(item, node.origin));
}

function lowerHtmlNodeCore(node: MdxNode, context: HtmlLoweringContext): LoweredHtml {
  switch (node.kind) {
    case "text":
      return new HtmlTextNode(node.value);
    case "emphasis":
      return htmlElement("em", node.children, context);
    case "strong":
      return htmlElement("strong", node.children, context);
    case "delete":
      return htmlElement("del", node.children, context);
    case "directiveLabel":
      return new HtmlFragmentNode(lowerChildren(node.children, context));
    case "textDirective":
      return lowerTextDirective(node, context);
    case "inlineCode":
      return new HtmlElementNode("code", {}, [
        new HtmlTextNode(node.value.replace(/\r\n?|\n/gu, " ")),
      ]);
    case "inlineMath":
      return new HtmlMathNode({
        source: node.value.replace(/\r\n?|\n/gu, " "),
        style: "inline",
      });
    case "hardBreak":
      return [new HtmlElementNode("br"), new HtmlTextNode("\n")];
    case "link":
      return lowerLink(node, context);
    case "linkReference": {
      const definition = context.definition(node.identifier);
      return definition === undefined
        ? revertReference(node, context)
        : lowerDefinedLink(node.children, definition, context);
    }
    case "image":
      return lowerImage(node.url, node.alt, node.title, context);
    case "imageReference": {
      const definition = context.definition(node.identifier);
      return definition === undefined
        ? new HtmlTextNode(node.toSource())
        : lowerImage(definition.url, node.alt, definition.title, context);
    }
    case "footnoteReference":
      return context.footnoteReference(node);
    case "definition":
    case "footnoteDefinition":
    case "frontmatter":
      return undefined;
    case "leafDirective":
      return lowerLeafDirective(node, context);
    case "containerDirective":
      return lowerContainerDirective(node, context);
    case "rawHtmlBlock":
    case "rawHtmlInline":
      return new HtmlRawNode(node.value);
    case "inlineExpression":
    case "blockExpression":
      return new HtmlTextNode(node.sourceText() ?? node.toSource());
    case "jsxTextElement":
    case "jsxFlowElement": {
      return new HtmlJsxNode(node.sourceText() ?? node.toSource(), {
        kind: "complete",
        node,
        children: lowerChildren(node.children, context),
      });
    }
    case "jsxAttribute":
    case "jsxAttributeValueExpression":
    case "jsxSpreadAttribute":
      return new HtmlTextNode(node.sourceText() ?? node.toSource());
    case "esm":
      return undefined;
    case "paragraph":
      return htmlElement("p", node.children, context);
    case "heading":
      return htmlElement(`h${node.depth}`, node.children, context);
    case "codeBlock": {
      const language = node.language?.trim().split(/\s+/u)[0];
      return language === undefined || language.length === 0
        ? new HtmlElementNode("pre", {}, [
            new HtmlElementNode("code", {}, [
              new HtmlTextNode(node.value.length === 0 ? "" : `${node.value}\n`),
            ]),
          ])
        : new HtmlCodeBlockNode({
            code: node.value,
            language,
            meta: node.meta,
          });
    }
    case "displayMath":
      return new HtmlMathNode({
        source: node.value,
        style: "display",
        meta: node.meta,
      });
    case "thematicBreak":
      return new HtmlElementNode("hr");
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
      return new HtmlElementNode(
        "blockquote",
        {},
        wrap(lowerChildren(node.children, context), true),
      );
    case "document":
      return new HtmlFragmentNode(wrap(lowerChildren(node.children, context), false));
    default: {
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}

function htmlNodeWithOrigin(node: HtmlNode, origin: SourceSpan | undefined): HtmlNode {
  if (origin === undefined || node.origin !== undefined) {
    return node;
  }
  if (node instanceof HtmlJsxNode) {
    return new HtmlJsxNode(node.value, node.request, origin);
  }
  if (node instanceof HtmlTextNode) {
    return new HtmlTextNode(node.value, origin);
  }
  if (node instanceof HtmlRawNode) {
    return new HtmlRawNode(node.value, origin);
  }
  if (node instanceof HtmlCommentNode) {
    return new HtmlCommentNode(node.value, origin);
  }
  if (node instanceof HtmlDoctypeNode) {
    return new HtmlDoctypeNode(origin);
  }
  if (node instanceof HtmlCodeBlockNode) {
    return new HtmlCodeBlockNode(node.codeBlock, origin);
  }
  if (node instanceof HtmlFootnoteReferenceNode) {
    return new HtmlFootnoteReferenceNode(node.footnoteReference, node.children, origin);
  }
  if (node instanceof HtmlFootnoteSectionNode) {
    return new HtmlFootnoteSectionNode(node.footnoteSection, node.children, origin);
  }
  if (node instanceof HtmlMathNode) {
    return new HtmlMathNode(node.math, origin);
  }
  if (node instanceof HtmlElementNode) {
    return new HtmlElementNode(node.tagName, node.attributes, node.children, origin);
  }
  if (node instanceof HtmlDocumentNode) {
    return new HtmlDocumentNode(node.children, origin);
  }
  if (node instanceof HtmlFragmentNode) {
    return new HtmlFragmentNode(node.children, origin);
  }
  return node;
}

function lowerTextDirective(
  node: TextDirectiveNode,
  context: HtmlLoweringContext,
): HtmlElementNode {
  return new HtmlElementNode(
    "span",
    directiveHtmlAttributes(node.name, "text", node.attributes.entries),
    node.label === undefined ? [] : lowerChildren(node.label.children, context),
  );
}

function lowerLeafDirective(
  node: LeafDirectiveNode,
  context: HtmlLoweringContext,
): HtmlElementNode {
  const children =
    node.label === undefined
      ? []
      : [
          new HtmlElementNode(
            "span",
            { "data-directive-label": "" },
            lowerChildren(node.label.children, context),
          ),
        ];
  return new HtmlElementNode(
    "div",
    directiveHtmlAttributes(node.name, "leaf", node.attributes.entries),
    children,
  );
}

function lowerContainerDirective(
  node: ContainerDirectiveNode,
  context: HtmlLoweringContext,
): HtmlElementNode {
  const children: HtmlNode[] = [];
  if (node.label !== undefined) {
    children.push(
      new HtmlElementNode(
        "span",
        { "data-directive-label": "" },
        lowerChildren(node.label.children, context),
      ),
    );
  }
  children.push(...lowerChildren(node.body, context));
  return new HtmlElementNode(
    "div",
    directiveHtmlAttributes(node.name, "container", node.attributes.entries),
    wrap(children, true),
  );
}

function directiveHtmlAttributes(
  name: string,
  kind: "container" | "leaf" | "text",
  entries: readonly { readonly name: string; readonly value: string }[],
): Readonly<Record<string, HtmlAttributeValue>> {
  return {
    "data-directive": name,
    "data-directive-kind": kind,
    ...(entries.length === 0
      ? {}
      : {
          "data-directive-attributes": JSON.stringify(
            entries.map((entry) => [entry.name, entry.value]),
          ),
        }),
  };
}

function lowerFootnoteReference(
  node: FootnoteReferenceNode,
  info: FootnoteReferenceInfo | undefined,
  options: HtmlRenderOptions,
): HtmlNode {
  if (info === undefined) {
    return new HtmlTextNode(node.toSource());
  }
  const prefix = options.clobberPrefix ?? "user-content-";
  const identifier = normalizeUri(node.identifier.toLowerCase());
  const suffix = info.reuse > 1 ? `-${info.reuse}` : "";
  return new HtmlFootnoteReferenceNode(
    {
      identifier: node.identifier,
      occurrence: info.reuse,
      ordinal: info.index + 1,
    },
    [
      new HtmlElementNode(
        "a",
        {
          href: `#${prefix}fn-${identifier}`,
          id: `${prefix}fnref-${identifier}${suffix}`,
          "data-footnote-ref": "",
          "aria-describedby": "footnote-label",
        },
        [new HtmlTextNode(String(info.index + 1))],
      ),
    ],
  );
}

function lowerFootnoteSection(
  document: DocumentNode,
  order: readonly string[],
  counts: ReadonlyMap<string, number>,
  context: HtmlLoweringContext,
): HtmlElementNode | undefined {
  if (order.length === 0) {
    return undefined;
  }
  const prefix = context.options.clobberPrefix ?? "user-content-";
  const items: HtmlElementNode[] = [];
  for (let index = 0; index < order.length; index++) {
    const identifier = order[index];
    const definition = document.footnote(identifier);
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
    if (tail instanceof HtmlElementNode && tail.tagName === "p") {
      blocks[blocks.length - 1] = tail.with({
        children: [
          ...tail.children,
          ...(tail.children.length === 0 ? [] : [new HtmlTextNode(" ")]),
          ...backreferences,
        ],
      });
    } else {
      if (blocks.length > 0) {
        blocks.push(new HtmlTextNode("\n"));
      }
      blocks.push(...backreferences);
    }
    items.push(
      new HtmlElementNode("li", { id: `${prefix}fn-${safeIdentifier}` }, wrap(blocks, true)),
    );
  }
  const heading = new HtmlElementNode(
    context.options.footnoteLabelTagName ?? "h2",
    { id: "footnote-label", class: ["sr-only"] },
    [new HtmlTextNode(context.options.footnoteLabel ?? "Footnotes")],
  );
  return new HtmlFootnoteSectionNode(
    { identifiers: order },
    wrap([heading, new HtmlElementNode("ol", {}, wrap(items, true))], true),
  );
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
      values.push(new HtmlTextNode(" "));
    }
    const configured = options.footnoteBackLabel;
    const label =
      typeof configured === "function"
        ? configured(referenceIndex, reuse)
        : (configured ?? defaultFootnoteBackLabel(referenceIndex, reuse));
    values.push(
      new HtmlElementNode(
        "a",
        {
          href: `#${prefix}fnref-${identifier}${reuse > 1 ? `-${reuse}` : ""}`,
          "data-footnote-backref": "",
          "aria-label": label,
          class: ["data-footnote-backref"],
        },
        [
          new HtmlTextNode("↩"),
          ...(reuse > 1 ? [new HtmlElementNode("sup", {}, [new HtmlTextNode(String(reuse))])] : []),
        ],
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
    children.push(
      new HtmlElementNode("thead", {}, [lowerTableRow(head, node.alignments, true, context)]),
    );
  }
  if (node.children.length > 1) {
    children.push(
      new HtmlElementNode(
        "tbody",
        {},
        node.children.slice(1).map((row) => lowerTableRow(row, node.alignments, false, context)),
      ),
    );
  }
  return new HtmlElementNode("table", {}, children);
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
    const cell: TableCellNode | undefined = node.children[index];
    const alignment = alignments?.[index];
    cells.push(
      new HtmlElementNode(
        heading ? "th" : "td",
        alignment === undefined || alignment === "none" ? {} : { align: alignment },
        cell === undefined ? [] : lowerChildren(cell.children, context),
      ),
    );
  }
  return new HtmlElementNode("tr", {}, cells);
}

function lowerLink(node: LinkNode, context: HtmlLoweringContext): HtmlElementNode {
  const url = sanitizeUrl(node.url, context.options, "link");
  const attributes: Record<string, HtmlAttributeValue> = {};
  if (url !== undefined) {
    attributes.href = url;
    if (node.title !== undefined) {
      attributes.title = node.title;
    }
  }
  return new HtmlElementNode("a", attributes, lowerChildren(node.children, context));
}

function lowerDefinedLink(
  children: readonly MdxNode[],
  definition: DefinitionNode,
  context: HtmlLoweringContext,
): HtmlElementNode {
  const url = sanitizeUrl(definition.url, context.options, "link");
  const attributes: Record<string, HtmlAttributeValue> = {};
  if (url !== undefined) {
    attributes.href = url;
    if (definition.title !== undefined) {
      attributes.title = definition.title;
    }
  }
  return new HtmlElementNode("a", attributes, lowerChildren(children, context));
}

function lowerImage(
  source: string,
  alt: string,
  title: string | undefined,
  context: HtmlLoweringContext,
): HtmlNode {
  const url = sanitizeUrl(source, context.options, "image");
  if (url === undefined) {
    return new HtmlTextNode(alt);
  }
  const attributes: Record<string, HtmlAttributeValue> = { src: url, alt };
  if (title !== undefined) {
    attributes.title = title;
  }
  return new HtmlElementNode("img", attributes);
}

function lowerList(node: ListNode, context: HtmlLoweringContext): HtmlElementNode {
  const loose = node.spread || node.items.some((item) => item.spread);
  const itemContext: HtmlLoweringContext = { ...context, listLoose: loose };
  const items = node.items.map((item) => lowerListItem(item, itemContext));
  const containsTasks = items.some((item) => item.hasClass("task-list-item"));
  const attributes: Record<string, HtmlAttributeValue> = {};
  if (node.ordered && node.start !== 1) {
    attributes.start = node.start;
  }
  if (containsTasks) {
    attributes.class = ["contains-task-list"];
  }
  return new HtmlElementNode(node.ordered ? "ol" : "ul", attributes, wrap(items, true));
}

function lowerListItem(node: ListItemNode, context: HtmlLoweringContext): HtmlElementNode {
  const blocks = [...lowerChildren(node.children, context)];
  if (node.checked !== undefined) {
    const checkbox = new HtmlElementNode("input", {
      type: "checkbox",
      disabled: true,
      ...(node.checked ? { checked: true } : {}),
    });
    const first = blocks[0];
    if (first instanceof HtmlElementNode && first.tagName === "p") {
      blocks[0] = first.with({
        children: [
          checkbox,
          ...(first.children.length === 0 ? [] : [new HtmlTextNode(" ")]),
          ...first.children,
        ],
      });
    } else {
      blocks.unshift(new HtmlElementNode("p", {}, [checkbox]));
    }
  }
  const children: HtmlNode[] = [];
  for (let index = 0; index < blocks.length; index++) {
    const child = blocks[index];
    if (
      context.listLoose ||
      index !== 0 ||
      !(child instanceof HtmlElementNode) ||
      child.tagName !== "p"
    ) {
      children.push(new HtmlTextNode("\n"));
    }
    if (child instanceof HtmlElementNode && child.tagName === "p" && !context.listLoose) {
      children.push(...child.children);
    } else {
      children.push(child);
    }
  }
  const tail = blocks.at(-1);
  if (
    tail !== undefined &&
    (context.listLoose || !(tail instanceof HtmlElementNode) || tail.tagName !== "p")
  ) {
    children.push(new HtmlTextNode("\n"));
  }
  return new HtmlElementNode(
    "li",
    node.checked === undefined ? {} : { class: ["task-list-item"] },
    children,
  );
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
    return [new HtmlTextNode(`[${suffix}`)];
  }
  const result = [...children];
  const first = result[0];
  result[0] =
    first instanceof HtmlTextNode
      ? new HtmlTextNode(`[${first.value}`)
      : new HtmlFragmentNode([new HtmlTextNode("["), first]);
  const lastIndex = result.length - 1;
  const last = result[lastIndex];
  result[lastIndex] =
    last instanceof HtmlTextNode
      ? new HtmlTextNode(last.value + suffix)
      : new HtmlFragmentNode([last, new HtmlTextNode(suffix)]);
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
    const additions = isHtmlNode(lowered) ? [lowered] : [...lowered];
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
  return new HtmlElementNode(tagName, {}, lowerChildren(children, context));
}

function trimSpaceStart(node: HtmlNode): HtmlNode {
  if (node instanceof HtmlTextNode) {
    return new HtmlTextNode(node.value.replace(/^[\t ]+/u, ""));
  }
  if (node instanceof HtmlElementNode) {
    const first = node.children[0];
    if (first instanceof HtmlTextNode) {
      return new HtmlElementNode(node.tagName, node.attributes, [
        new HtmlTextNode(first.value.replace(/^[\t ]+/u, "")),
        ...node.children.slice(1),
      ]);
    }
  }
  return node;
}

function wrap(nodes: readonly HtmlNode[], loose: boolean): HtmlNode[] {
  const result: HtmlNode[] = [];
  if (loose) {
    result.push(new HtmlTextNode("\n"));
  }
  nodes.forEach((node, index) => {
    if (index > 0) {
      result.push(new HtmlTextNode("\n"));
    }
    result.push(node);
  });
  if (loose && nodes.length > 0) {
    result.push(new HtmlTextNode("\n"));
  }
  return result;
}

function sanitizeUrl(
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

function normalizeUri(value: string): string {
  const result: string[] = [];
  const characters = Array.from(value);
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index];
    const hexadecimal = `${characters[index + 1] ?? ""}${characters[index + 2] ?? ""}`;
    if (character === "%" && percentEncodedByte.test(hexadecimal)) {
      result.push(character, hexadecimal);
      index += hexadecimal.length;
      continue;
    }
    if (uriCharacters.includes(character)) {
      result.push(character);
      continue;
    }
    const scalar = loneSurrogate.test(character) ? replacementCharacter : character;
    result.push(encodeURIComponent(scalar));
  }
  return result.join("");
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

function isUrlControlCharacter(character: string): boolean {
  return character === "\0" || character <= " " || character === deleteCharacter;
}
