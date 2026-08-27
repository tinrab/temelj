import { isPlainObject } from "@temelj/value";
import { find, html, svg, type Schema } from "property-information";

import { isHeadingDepth, type HeadingDepth } from "../heading.ts";
import {
  HtmlCommentNode,
  HtmlCodeBlockNode,
  HtmlDoctypeNode,
  HtmlDocumentNode,
  HtmlElementNode,
  HtmlJsxNode,
  HtmlMathNode,
  HtmlRawNode,
  HtmlTextNode,
  type HtmlAttributeValue,
  type HtmlNode,
} from "../html.ts";
import {
  BlockExpressionNode,
  BlockQuoteNode,
  CodeBlockNode,
  ContainerDirectiveNode,
  DefinitionNode,
  DeleteNode,
  DirectiveAttribute,
  DirectiveAttributes,
  DirectiveLabelNode,
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
  LeafDirectiveNode,
  LinkNode,
  LinkReferenceNode,
  ListItemNode,
  ListNode,
  ParagraphNode,
  RawHtmlBlockNode,
  RawHtmlInlineNode,
  SourceFile,
  StrongNode,
  TableCellNode,
  TableNode,
  TableRowNode,
  TextDirectiveNode,
  TextNode,
  ThematicBreakNode,
  type FlowContent,
  type JsxAttributeLike,
  type MdxNode,
  type PhrasingContent,
  type ReferenceKind,
  type SourceSpan,
  type TableAlignment,
} from "../model.ts";

type UnistRecord = Record<string, unknown> & {
  readonly type: string;
};

const unifiedDataKeys = {
  directiveLabel: "temeljDirectiveLabel",
  mathFormat: "temeljMathFormat",
} as const;

export class UnifiedBoundaryError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "UnifiedBoundaryError";
  }
}

export class UnifiedTreeBridge {
  private readonly file: SourceFile;
  private readonly ownedHtmlNodes = new WeakMap<object, HtmlNode>();
  public readonly visiting = new WeakSet<object>();

  public constructor(file: SourceFile) {
    this.file = file;
  }

  public toMdast(document: DocumentNode): UnistRecord {
    const node = this.mdxToUnist(document);
    if (node.type !== "root") {
      throw new UnifiedBoundaryError("The document bridge did not produce an mdast root");
    }
    return node;
  }

  public fromMdast(root: unknown): DocumentNode {
    const node = this.unistToMdx(root);
    if (!(node instanceof DocumentNode)) {
      throw new UnifiedBoundaryError(
        `Remark returned a ${node.kind} node instead of an mdast root`,
      );
    }
    return node;
  }

  public toHast(document: HtmlDocumentNode): UnistRecord {
    const node = this.htmlToUnist(document);
    if (node.type !== "root") {
      throw new UnifiedBoundaryError("The HTML bridge did not produce a HAST root");
    }
    return node;
  }

  public fromHast(root: unknown): HtmlDocumentNode {
    const node = this.unistToHtml(root, false);
    if (!(node instanceof HtmlDocumentNode)) {
      throw new UnifiedBoundaryError(`Rehype returned a ${node.kind} node instead of a HAST root`);
    }
    return node;
  }

  public mdxToUnist(node: MdxNode): UnistRecord {
    const position = positionFromOrigin(node.origin);
    const base = position === undefined ? {} : { position };
    const children = (): UnistRecord[] => node.children.map((child) => this.mdxToUnist(child));
    switch (node.kind) {
      case "document":
        return { type: "root", children: children(), ...base };
      case "text":
        return { type: "text", value: node.value, ...base };
      case "emphasis":
        return { type: "emphasis", children: children(), ...base };
      case "strong":
        return { type: "strong", children: children(), ...base };
      case "delete":
        return { type: "delete", children: children(), ...base };
      case "inlineCode":
        return { type: "inlineCode", value: node.value, ...base };
      case "link":
        return {
          type: "link",
          url: node.url,
          title: node.title ?? null,
          children: children(),
          ...base,
        };
      case "image":
        return { type: "image", url: node.url, alt: node.alt, title: node.title ?? null, ...base };
      case "linkReference":
        return {
          type: "linkReference",
          identifier: node.identifier,
          referenceType: node.referenceKind,
          children: children(),
          ...base,
        };
      case "imageReference":
        return {
          type: "imageReference",
          identifier: node.identifier,
          referenceType: node.referenceKind,
          alt: node.alt,
          ...base,
        };
      case "hardBreak":
        return { type: "break", ...base };
      case "rawHtmlInline":
      case "rawHtmlBlock":
        return { type: "html", value: node.value, ...base };
      case "footnoteReference":
        return {
          type: "footnoteReference",
          identifier: node.identifier,
          label: node.label,
          ...base,
        };
      case "definition":
        return {
          type: "definition",
          identifier: node.identifier,
          url: node.url,
          title: node.title ?? null,
          ...base,
        };
      case "footnoteDefinition":
        return {
          type: "footnoteDefinition",
          identifier: node.identifier,
          label: node.label,
          children: children(),
          ...base,
        };
      case "frontmatter":
        return { type: node.format, value: node.value, ...base };
      case "inlineMath":
        return {
          type: "inlineMath",
          value: node.value,
          data: { [unifiedDataKeys.mathFormat]: node.format },
          ...base,
        };
      case "displayMath":
        return {
          type: "math",
          value: node.value,
          meta: node.meta ?? null,
          data: { [unifiedDataKeys.mathFormat]: node.format },
          ...base,
        };
      case "paragraph":
        return { type: "paragraph", children: children(), ...base };
      case "heading":
        return { type: "heading", depth: node.depth, children: children(), ...base };
      case "codeBlock":
        return {
          type: "code",
          value: node.value,
          lang: node.language ?? null,
          meta: node.meta ?? null,
          ...base,
        };
      case "thematicBreak":
        return { type: "thematicBreak", ...base };
      case "blockquote":
        return { type: "blockquote", children: children(), ...base };
      case "listItem":
        return {
          type: "listItem",
          checked: node.checked ?? null,
          spread: node.spread,
          children: children(),
          ...base,
        };
      case "list":
        return {
          type: "list",
          ordered: node.ordered,
          start: node.ordered ? node.start : null,
          spread: node.spread,
          children: children(),
          ...base,
        };
      case "tableCell":
        return { type: "tableCell", children: children(), ...base };
      case "tableRow":
        return { type: "tableRow", children: children(), ...base };
      case "table":
        return {
          type: "table",
          align: node.alignments.map((value) => (value === "none" ? null : value)),
          children: children(),
          ...base,
        };
      case "directiveLabel":
        return { type: "temeljDirectiveLabel", children: children(), ...base };
      case "textDirective":
        return directiveToUnist("textDirective", node, base, this);
      case "leafDirective":
        return directiveToUnist("leafDirective", node, base, this);
      case "containerDirective": {
        const value = directiveToUnist("containerDirective", node, base, this);
        value.children = node.body.map((child) => this.mdxToUnist(child));
        if (node.label !== undefined) {
          value.data = { [unifiedDataKeys.directiveLabel]: this.mdxToUnist(node.label) };
        }
        return value;
      }
      case "inlineExpression":
        return { type: "mdxTextExpression", value: node.code, ...base };
      case "blockExpression":
        return { type: "mdxFlowExpression", value: node.code, ...base };
      case "esm":
        return { type: "mdxjsEsm", value: node.code, ...base };
      case "jsxTextElement":
        return jsxElementToUnist("mdxJsxTextElement", node, base, this);
      case "jsxFlowElement":
        return jsxElementToUnist("mdxJsxFlowElement", node, base, this);
      case "jsxAttribute":
        return jsxAttributeToUnist(node, base);
      case "jsxSpreadAttribute":
        return { type: "mdxJsxExpressionAttribute", value: node.code, ...base };
      case "jsxAttributeValueExpression":
        return { type: "mdxJsxAttributeValueExpression", value: node.code, ...base };
      default: {
        const exhaustive: never = node;
        return exhaustive;
      }
    }
  }

  public unistToMdx(value: unknown, mode: "flow" | "phrasing" = "flow"): MdxNode {
    const node = this.nodeRecord(value);
    const origin = this.origin(node.position);
    const children = (childMode: "flow" | "phrasing" = "flow"): MdxNode[] =>
      this.nodeChildren(node).map((child) => this.unistToMdx(child, childMode));
    let result: MdxNode;
    switch (node.type) {
      case "root":
        result = new DocumentNode(flow(children(), node.type), origin);
        break;
      case "text":
        result = new TextNode(stringField(node, "value"), origin);
        break;
      case "emphasis":
        result = new EmphasisNode(phrasing(children("phrasing"), node.type), origin);
        break;
      case "strong":
        result = new StrongNode(phrasing(children("phrasing"), node.type), origin);
        break;
      case "delete":
        result = new DeleteNode(phrasing(children("phrasing"), node.type), origin);
        break;
      case "inlineCode":
        result = new InlineCodeNode(stringField(node, "value"), origin);
        break;
      case "link":
        result = new LinkNode(stringField(node, "url"), phrasing(children("phrasing"), node.type), {
          title: nullableString(node.title),
          origin,
        });
        break;
      case "image":
        result = new ImageNode(stringField(node, "url"), nullableString(node.alt) ?? "", {
          title: nullableString(node.title),
          origin,
        });
        break;
      case "linkReference":
        result = new LinkReferenceNode(
          stringField(node, "identifier"),
          phrasing(children("phrasing"), node.type),
          { referenceKind: referenceKind(node.referenceType), origin },
        );
        break;
      case "imageReference":
        result = new ImageReferenceNode(
          stringField(node, "identifier"),
          nullableString(node.alt) ?? "",
          { referenceKind: referenceKind(node.referenceType), origin },
        );
        break;
      case "break":
        result = new HardBreakNode(origin);
        break;
      case "html":
        result =
          mode === "phrasing"
            ? new RawHtmlInlineNode(stringField(node, "value"), origin)
            : new RawHtmlBlockNode(stringField(node, "value"), origin);
        break;
      case "footnoteReference":
        result = new FootnoteReferenceNode(stringField(node, "identifier"), {
          label: nullableString(node.label),
          origin,
        });
        break;
      case "definition":
        result = new DefinitionNode(stringField(node, "identifier"), stringField(node, "url"), {
          title: nullableString(node.title),
          origin,
        });
        break;
      case "footnoteDefinition":
        result = new FootnoteDefinitionNode(
          stringField(node, "identifier"),
          flow(children(), node.type),
          { label: nullableString(node.label), origin },
        );
        break;
      case "yaml":
      case "toml":
        result = new FrontmatterNode(node.type, stringField(node, "value"), { origin });
        break;
      case "inlineMath":
        result = new InlineMathNode(stringField(node, "value"), {
          format: mathFormat(node),
          origin,
        });
        break;
      case "math": {
        const format = mathFormat(node);
        const meta = nullableString(node.meta);
        result =
          format === "tex"
            ? new DisplayMathNode(stringField(node, "value"), { format, origin })
            : new DisplayMathNode(stringField(node, "value"), { format, meta, origin });
        break;
      }
      case "paragraph":
        result = new ParagraphNode(phrasing(children("phrasing"), node.type), origin);
        break;
      case "heading":
        result = new HeadingNode(
          headingDepth(node.depth),
          phrasing(children("phrasing"), node.type),
          origin,
        );
        break;
      case "code":
        result = new CodeBlockNode(stringField(node, "value"), {
          language: nullableString(node.lang),
          meta: nullableString(node.meta),
          origin,
        });
        break;
      case "thematicBreak":
        result = new ThematicBreakNode(origin);
        break;
      case "blockquote":
        result = new BlockQuoteNode(flow(children(), node.type), origin);
        break;
      case "listItem":
        result = new ListItemNode(flow(children(), node.type), {
          checked: nullableBoolean(node.checked),
          spread: booleanField(node.spread, false),
          origin,
        });
        break;
      case "list":
        result = new ListNode(listItems(children(), node.type), {
          ordered: booleanField(node.ordered, false),
          start: nullableNumber(node.start) ?? 1,
          spread: booleanField(node.spread, false),
          origin,
        });
        break;
      case "tableCell":
        result = new TableCellNode(phrasing(children("phrasing"), node.type), origin);
        break;
      case "tableRow":
        result = new TableRowNode(tableCells(children(), node.type), origin);
        break;
      case "table":
        result = new TableNode(
          tableAlignments(node.align),
          tableRows(children(), node.type),
          origin,
        );
        break;
      case "temeljDirectiveLabel":
        result = new DirectiveLabelNode(phrasing(children("phrasing"), node.type), origin);
        break;
      case "textDirective":
        result = new TextDirectiveNode(stringField(node, "name"), {
          label: directiveLabel(children("phrasing"), node.type),
          attributes: directiveAttributes(node.attributes),
          origin,
        });
        break;
      case "leafDirective":
        result = new LeafDirectiveNode(stringField(node, "name"), {
          label: directiveLabel(children("phrasing"), node.type),
          attributes: directiveAttributes(node.attributes),
          origin,
        });
        break;
      case "containerDirective":
        result = new ContainerDirectiveNode(
          stringField(node, "name"),
          flow(children(), node.type),
          {
            label: directiveDataLabel(node.data, this),
            attributes: directiveAttributes(node.attributes),
            origin,
          },
        );
        break;
      case "mdxTextExpression":
        result = new InlineExpressionNode(stringField(node, "value"), origin);
        break;
      case "mdxFlowExpression":
        result = new BlockExpressionNode(stringField(node, "value"), origin);
        break;
      case "mdxjsEsm":
        result = new EsmNode(stringField(node, "value"), origin);
        break;
      case "mdxJsxTextElement":
        result = new JsxTextElementNode(
          nullableString(node.name),
          jsxAttributes(node.attributes, this),
          phrasing(children("phrasing"), node.type),
          origin,
        );
        break;
      case "mdxJsxFlowElement":
        result = new JsxFlowElementNode(
          nullableString(node.name),
          jsxAttributes(node.attributes, this),
          flow(children(), node.type),
          origin,
        );
        break;
      default:
        throw new UnifiedBoundaryError(`Unsupported mdast node type: ${node.type}`);
    }
    this.visiting.delete(node);
    return result;
  }

  private htmlToUnist(node: HtmlNode): UnistRecord {
    const position = positionFromOrigin(node.origin);
    const base = position === undefined ? {} : { position };
    if (node instanceof HtmlDocumentNode) {
      return {
        type: "root",
        children: node.children.map((child) => this.htmlToUnist(child)),
        ...base,
      };
    }
    if (node instanceof HtmlJsxNode) {
      const result = { type: "text", value: node.value, ...base };
      this.ownedHtmlNodes.set(result, node);
      return result;
    }
    if (node instanceof HtmlTextNode) {
      const result = { type: "text", value: node.value, ...base };
      return result;
    }
    if (node instanceof HtmlRawNode) {
      return { type: "raw", value: node.value, ...base };
    }
    if (node instanceof HtmlCommentNode) {
      return { type: "comment", value: node.value, ...base };
    }
    if (node instanceof HtmlDoctypeNode) {
      return { type: "doctype", ...base };
    }
    if (node instanceof HtmlElementNode) {
      const result = {
        type: "element",
        tagName: node.tagName,
        properties: propertiesToHast(node.attributes, node.tagName === "svg" ? svg : html),
        children: node.children.map((child) => this.htmlToUnist(child)),
        ...base,
      };
      if (node instanceof HtmlMathNode || node instanceof HtmlCodeBlockNode) {
        this.ownedHtmlNodes.set(result, node);
      }
      return result;
    }
    if ("children" in node && Array.isArray(node.children)) {
      return {
        type: "root",
        children: node.children.map((child) => this.htmlToUnist(child)),
        ...base,
      };
    }
    throw new UnifiedBoundaryError(`Unsupported owned HTML node kind: ${node.kind}`);
  }

  private unistToHtml(value: unknown, inSvg: boolean): HtmlNode {
    const node = this.nodeRecord(value);
    const origin = this.origin(node.position);
    let result: HtmlNode;
    switch (node.type) {
      case "root":
        result = new HtmlDocumentNode(
          this.nodeChildren(node).map((child) => this.unistToHtml(child, inSvg)),
          origin,
        );
        break;
      case "text":
        result = new HtmlTextNode(stringField(node, "value"), origin);
        break;
      case "raw":
        result = new HtmlRawNode(stringField(node, "value"), origin);
        break;
      case "comment":
        result = new HtmlCommentNode(stringField(node, "value"), origin);
        break;
      case "doctype":
        result = new HtmlDoctypeNode(origin);
        break;
      case "element": {
        const tagName = stringField(node, "tagName");
        const svgElement = inSvg || tagName === "svg";
        const childSvg = svgElement && tagName !== "foreignObject";
        result = new HtmlElementNode(
          tagName,
          propertiesFromHast(node.properties ?? {}, svgElement ? svg : html),
          this.nodeChildren(node).map((child) => this.unistToHtml(child, childSvg)),
          origin,
        );
        break;
      }
      default:
        throw new UnifiedBoundaryError(`Unsupported HAST node type: ${node.type}`);
    }
    this.visiting.delete(node);
    const owned = this.ownedHtmlNodes.get(node);
    if (
      owned instanceof HtmlJsxNode &&
      result instanceof HtmlTextNode &&
      owned.value === result.value &&
      owned.origin?.start === result.origin?.start &&
      owned.origin?.end === result.origin?.end
    ) {
      return new HtmlJsxNode(result.value, owned.request, result.origin);
    }
    if (
      owned instanceof HtmlMathNode &&
      result instanceof HtmlElementNode &&
      owned.toHtml() === result.toHtml() &&
      owned.origin?.start === result.origin?.start &&
      owned.origin?.end === result.origin?.end
    ) {
      return new HtmlMathNode(owned.math, result.origin);
    }
    if (
      owned instanceof HtmlCodeBlockNode &&
      result instanceof HtmlElementNode &&
      owned.toHtml() === result.toHtml() &&
      owned.origin?.start === result.origin?.start &&
      owned.origin?.end === result.origin?.end
    ) {
      return new HtmlCodeBlockNode(owned.codeBlock, result.origin);
    }
    return result;
  }

  public nodeRecord(value: unknown): UnistRecord {
    if (!isUnistNode(value)) {
      throw new UnifiedBoundaryError("Unified returned a malformed node without a string type");
    }
    if (this.visiting.has(value)) {
      throw new UnifiedBoundaryError(`Unified returned a cyclic ${value.type} tree`);
    }
    this.visiting.add(value);
    return value;
  }

  private nodeChildren(node: UnistRecord): unknown[] {
    if (!Array.isArray(node.children)) {
      throw new UnifiedBoundaryError(`${node.type} must have a children array`);
    }
    return node.children;
  }

  public origin(position: unknown): SourceSpan | undefined {
    if (position === undefined) {
      return undefined;
    }
    if (
      !isPlainObject(position) ||
      !isPlainObject(position.start) ||
      !isPlainObject(position.end)
    ) {
      throw new UnifiedBoundaryError("A returned Unist position is malformed");
    }
    const start = position.start.offset;
    const end = position.end.offset;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      typeof start !== "number" ||
      typeof end !== "number" ||
      start < 0 ||
      end < start ||
      end > this.file.text.length
    ) {
      throw new UnifiedBoundaryError("A returned Unist position has invalid UTF-16 offsets");
    }
    return { file: this.file, start, end };
  }
}

function positionFromOrigin(origin: Readonly<SourceSpan> | undefined): unknown {
  if (origin === undefined) {
    return undefined;
  }
  return { start: origin.file.location(origin.start), end: origin.file.location(origin.end) };
}

function directiveToUnist(
  type: string,
  node: TextDirectiveNode | LeafDirectiveNode | ContainerDirectiveNode,
  base: object,
  bridge: UnifiedTreeBridge,
): UnistRecord {
  return {
    type,
    name: node.name,
    attributes: Object.fromEntries(
      node.attributes.entries.map((entry) => [entry.name, entry.value]),
    ),
    children:
      node.label === undefined ? [] : node.label.children.map((child) => bridge.mdxToUnist(child)),
    ...base,
  };
}

function jsxElementToUnist(
  type: string,
  node: JsxTextElementNode | JsxFlowElementNode,
  base: object,
  bridge: UnifiedTreeBridge,
): UnistRecord {
  return {
    type,
    name: node.name ?? null,
    attributes: node.attributes.map((attribute) => bridge.mdxToUnist(attribute)),
    children: node.children.map((child) => bridge.mdxToUnist(child)),
    ...base,
  };
}

function jsxAttributeToUnist(node: JsxAttributeNode, base: object): UnistRecord {
  const value =
    node.value instanceof JsxAttributeValueExpressionNode
      ? { type: "mdxJsxAttributeValueExpression", value: node.value.code }
      : (node.value ?? null);
  return { type: "mdxJsxAttribute", name: node.name, value, ...base };
}

function propertiesToHast(
  attributes: Readonly<Record<string, HtmlAttributeValue>>,
  schema: Schema,
): Record<string, HtmlAttributeValue> {
  const result: Record<string, HtmlAttributeValue> = Object.create(null);
  for (const [name, value] of Object.entries(attributes)) {
    result[find(schema, name).property] = value;
  }
  return result;
}

function propertiesFromHast(
  value: unknown,
  schema: Schema,
): Readonly<Record<string, HtmlAttributeValue>> {
  if (!isPlainObject(value)) {
    throw new UnifiedBoundaryError("HAST properties must be an object");
  }
  const result: Record<string, HtmlAttributeValue> = Object.create(null);
  for (const name of Object.keys(value)) {
    const item = value[name];
    if (item === null || item === undefined) {
      continue;
    }
    if (
      typeof item === "boolean" ||
      typeof item === "string" ||
      (typeof item === "number" && Number.isFinite(item))
    ) {
      result[find(schema, name).attribute] = item;
      continue;
    }
    if (
      Array.isArray(item) &&
      item.every(
        (entry) =>
          typeof entry === "string" || (typeof entry === "number" && Number.isFinite(entry)),
      )
    ) {
      result[find(schema, name).attribute] = [...item];
      continue;
    }
    throw new UnifiedBoundaryError(`Unsupported HAST property value for ${JSON.stringify(name)}`);
  }
  return result;
}

function stringField(node: UnistRecord, name: string): string {
  const value = node[name];
  if (typeof value !== "string") {
    throw new UnifiedBoundaryError(`${node.type}.${name} must be a string`);
  }
  return value;
}
function nullableString(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new UnifiedBoundaryError("Expected a string or null");
  }
  return value;
}
function nullableBoolean(value: unknown): boolean | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new UnifiedBoundaryError("Expected a boolean or null");
  }
  return value;
}
function booleanField(value: unknown, fallback: boolean): boolean {
  return value === undefined || value === null ? fallback : (nullableBoolean(value) ?? fallback);
}
function nullableNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new UnifiedBoundaryError("Expected a safe integer or null");
  }
  return value;
}
function headingDepth(value: unknown): HeadingDepth {
  if (isHeadingDepth(value)) {
    return value;
  }
  throw new UnifiedBoundaryError("heading.depth must be between 1 and 6");
}
function referenceKind(value: unknown): ReferenceKind {
  if (value === "full" || value === "collapsed" || value === "shortcut") {
    return value;
  }
  throw new UnifiedBoundaryError("A reference has an invalid referenceType");
}
function mathFormat(node: UnistRecord): "dollar" | "tex" {
  return isPlainObject(node.data) && node.data[unifiedDataKeys.mathFormat] === "tex"
    ? "tex"
    : "dollar";
}
function tableAlignments(value: unknown): TableAlignment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) =>
    item === null
      ? "none"
      : item === "left" || item === "right" || item === "center"
        ? item
        : (() => {
            throw new UnifiedBoundaryError("table.align contains an invalid value");
          })(),
  );
}
function directiveAttributes(value: unknown): DirectiveAttributes {
  if (value === null || value === undefined) {
    return new DirectiveAttributes();
  }
  if (!isPlainObject(value)) {
    throw new UnifiedBoundaryError("Directive attributes must be an object");
  }
  return new DirectiveAttributes(
    Object.keys(value).map(
      (name) => new DirectiveAttribute(name, nullableString(value[name]) ?? ""),
    ),
  );
}
function directiveLabel(values: MdxNode[], type: string): DirectiveLabelNode | undefined {
  return values.length === 0 ? undefined : new DirectiveLabelNode(phrasing(values, type));
}
function directiveDataLabel(
  value: unknown,
  bridge: UnifiedTreeBridge,
): DirectiveLabelNode | undefined {
  if (!isPlainObject(value) || value[unifiedDataKeys.directiveLabel] === undefined) {
    return undefined;
  }
  const label = bridge.unistToMdx(value[unifiedDataKeys.directiveLabel]);
  if (!(label instanceof DirectiveLabelNode)) {
    throw new UnifiedBoundaryError("Container directive label is malformed");
  }
  return label;
}
function jsxAttributes(value: unknown, bridge: UnifiedTreeBridge): JsxAttributeLike[] {
  if (!Array.isArray(value)) {
    throw new UnifiedBoundaryError("MDX JSX attributes must be an array");
  }
  return value.map((item) => {
    const node = bridge.nodeRecord(item);
    const origin = bridge.origin(node.position);
    bridge.visiting.delete(node);
    if (node.type === "mdxJsxExpressionAttribute") {
      return new JsxSpreadAttributeNode(stringField(node, "value"), origin);
    }
    if (node.type !== "mdxJsxAttribute") {
      throw new UnifiedBoundaryError(`Unsupported MDX JSX attribute type: ${node.type}`);
    }
    const name = stringField(node, "name");
    if (node.value === null || node.value === undefined || typeof node.value === "string") {
      return new JsxAttributeNode(name, { value: node.value ?? undefined, origin });
    }
    const expression = bridge.nodeRecord(node.value);
    if (expression.type !== "mdxJsxAttributeValueExpression") {
      throw new UnifiedBoundaryError("Unsupported MDX JSX attribute value");
    }
    bridge.visiting.delete(expression);
    return new JsxAttributeNode(name, {
      value: new JsxAttributeValueExpressionNode(
        stringField(expression, "value"),
        bridge.origin(expression.position),
      ),
      origin,
    });
  });
}
function phrasing(values: MdxNode[], parent: string): PhrasingContent[] {
  if (!values.every(isPhrasing)) {
    throw new UnifiedBoundaryError(`${parent} contains non-phrasing content`);
  }
  return values;
}
function flow(values: MdxNode[], parent: string): FlowContent[] {
  if (!values.every(isFlow)) {
    throw new UnifiedBoundaryError(`${parent} contains non-flow content`);
  }
  return values;
}
function listItems(values: MdxNode[], parent: string): ListItemNode[] {
  if (!values.every((node): node is ListItemNode => node.kind === "listItem")) {
    throw new UnifiedBoundaryError(`${parent} contains a non-list-item child`);
  }
  return values;
}
function tableCells(values: MdxNode[], parent: string): TableCellNode[] {
  if (!values.every((node): node is TableCellNode => node.kind === "tableCell")) {
    throw new UnifiedBoundaryError(`${parent} contains a non-table-cell child`);
  }
  return values;
}
function tableRows(values: MdxNode[], parent: string): TableRowNode[] {
  if (!values.every((node): node is TableRowNode => node.kind === "tableRow")) {
    throw new UnifiedBoundaryError(`${parent} contains a non-table-row child`);
  }
  return values;
}
function isPhrasing(node: MdxNode): node is PhrasingContent {
  switch (node.kind) {
    case "text":
    case "emphasis":
    case "strong":
    case "delete":
    case "inlineCode":
    case "hardBreak":
    case "link":
    case "image":
    case "linkReference":
    case "imageReference":
    case "rawHtmlInline":
    case "footnoteReference":
    case "textDirective":
    case "inlineMath":
    case "jsxTextElement":
    case "inlineExpression":
      return true;
    default:
      return false;
  }
}
function isFlow(node: MdxNode): node is FlowContent {
  switch (node.kind) {
    case "paragraph":
    case "heading":
    case "codeBlock":
    case "thematicBreak":
    case "blockquote":
    case "list":
    case "definition":
    case "rawHtmlBlock":
    case "footnoteDefinition":
    case "frontmatter":
    case "leafDirective":
    case "containerDirective":
    case "displayMath":
    case "table":
    case "blockExpression":
    case "esm":
    case "jsxFlowElement":
      return true;
    default:
      return false;
  }
}

function isUnistNode(value: unknown): value is UnistRecord {
  return isPlainObject(value) && typeof value.type === "string";
}
