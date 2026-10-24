import { isNumber, isBoolean, isString, isPlainObject } from "@temelj/value";
import { find, html, svg, type Schema } from "property-information";

import type { HtmlAttributeValue, HtmlAttributes, HtmlNode, HtmlRootNode } from "../html.ts";
import type {
  ContainerDirectiveNode,
  DirectiveAttribute,
  DirectiveLabelNode,
  DocumentNode,
  FlowContent,
  JsxAttribute,
  JsxAttributeLike,
  JsxFlowElementNode,
  JsxTextElementNode,
  LeafDirectiveNode,
  ListItemNode,
  MdxNode,
  PhrasingContent,
  ReferenceKind,
  TableAlignment,
  TableCellNode,
  TableRowNode,
  TextDirectiveNode,
} from "../model.ts";
import type { SourceRange } from "../ranges.ts";
import type { SourceFile } from "../source.ts";

import { isHeadingDepth, type HeadingDepth } from "../heading.ts";
import { htmlChildren, htmlFallback, htmlText } from "../html.ts";
import { normalizeIdentifier } from "../identifier.ts";
import { isFlowContent, isPhrasingContent } from "../model.ts";

interface UnistRecord {
  readonly type: string;
  readonly align?: unknown;
  readonly alt?: unknown;
  readonly attributes?: unknown;
  readonly checked?: unknown;
  children?: unknown;
  data?: unknown;
  readonly depth?: unknown;
  readonly identifier?: unknown;
  readonly label?: unknown;
  readonly lang?: unknown;
  readonly meta?: unknown;
  readonly name?: unknown;
  readonly ordered?: unknown;
  readonly position?: unknown;
  readonly properties?: unknown;
  readonly referenceType?: unknown;
  readonly spread?: unknown;
  readonly start?: unknown;
  readonly tagName?: unknown;
  readonly title?: unknown;
  readonly url?: unknown;
  readonly value?: unknown;
}

interface UnistPosition {
  readonly start: ReturnType<SourceFile["location"]>;
  readonly end: ReturnType<SourceFile["location"]>;
}

interface UnistOrigin {
  readonly position?: UnistPosition;
}

const unifiedDataKeys = {
  directiveLabel: "temeljDirectiveLabel",
  htmlNode: "temeljHtmlNode",
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
  public readonly visiting: WeakSet<object> = new WeakSet<object>();
  /** Semantic HTML nodes sent to rehype. HAST data refers to them by index. */
  readonly #owned: HtmlNode[] = [];

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

    if (node.kind !== "document") {
      throw new UnifiedBoundaryError(
        `Remark returned a ${node.kind} node instead of an mdast root`,
      );
    }

    return node;
  }

  public toHast(document: HtmlRootNode): UnistRecord {
    const node = this.htmlToUnist(document);

    if (node.type !== "root") {
      throw new UnifiedBoundaryError("The HTML bridge did not produce a HAST root");
    }

    return node;
  }

  public fromHast(root: unknown): HtmlRootNode {
    const node = this.unistToHtml(root, false);

    if (node.kind !== "root") {
      throw new UnifiedBoundaryError(`Rehype returned a ${node.kind} node instead of a HAST root`);
    }

    return node;
  }

  public mdxToUnist(node: MdxNode): UnistRecord {
    const base = this.positionBase(node.origin);

    const children = (): UnistRecord[] =>
      "children" in node ? node.children.map((child) => this.mdxToUnist(child)) : [];

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
        value.children = children();

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

    const phrasingChildren = (): PhrasingContent[] => phrasing(children("phrasing"), node.type);
    const flowChildren = (): FlowContent[] => flow(children(), node.type);

    let result: MdxNode;

    switch (node.type) {
      case "root":
        result = { kind: "document", children: flowChildren(), origin };
        break;
      case "text":
        result = { kind: "text", value: stringField(node, "value"), origin };
        break;
      case "emphasis":
      case "strong":
      case "delete":
        result = { kind: node.type, children: phrasingChildren(), origin };
        break;
      case "inlineCode":
        result = { kind: "inlineCode", value: stringField(node, "value"), origin };
        break;
      case "link":
        result = {
          kind: "link",
          url: stringField(node, "url"),
          title: nullableString(node.title),
          children: phrasingChildren(),
          origin,
        };
        break;
      case "image":
        result = {
          kind: "image",
          url: stringField(node, "url"),
          alt: nullableString(node.alt) ?? "",
          title: nullableString(node.title),
          origin,
        };
        break;
      case "linkReference":
        result = {
          kind: "linkReference",
          identifier: normalizeIdentifier(stringField(node, "identifier")),
          referenceKind: referenceKind(node.referenceType),
          children: phrasingChildren(),
          origin,
        };
        break;
      case "imageReference":
        result = {
          kind: "imageReference",
          identifier: normalizeIdentifier(stringField(node, "identifier")),
          alt: nullableString(node.alt) ?? "",
          referenceKind: referenceKind(node.referenceType),
          origin,
        };
        break;
      case "break":
        result = { kind: "hardBreak", origin };
        break;
      case "html":
        result = {
          kind: mode === "phrasing" ? "rawHtmlInline" : "rawHtmlBlock",
          value: stringField(node, "value"),
          origin,
        };
        break;
      case "footnoteReference": {
        const identifier = stringField(node, "identifier");
        result = {
          kind: "footnoteReference",
          identifier: normalizeIdentifier(identifier),
          label: nullableString(node.label) ?? identifier,
          origin,
        };
        break;
      }

      case "definition":
        result = {
          kind: "definition",
          identifier: normalizeIdentifier(stringField(node, "identifier")),
          url: stringField(node, "url"),
          title: nullableString(node.title),
          origin,
        };
        break;
      case "footnoteDefinition": {
        const identifier = stringField(node, "identifier");
        result = {
          kind: "footnoteDefinition",
          identifier: normalizeIdentifier(identifier),
          label: nullableString(node.label) ?? identifier,
          children: flowChildren(),
          origin,
        };
        break;
      }

      case "yaml":
      case "toml":
        result = {
          kind: "frontmatter",
          format: node.type,
          value: stringField(node, "value"),
          origin,
        };
        break;
      case "inlineMath":
        result = {
          kind: "inlineMath",
          value: stringField(node, "value"),
          format: mathFormat(node),
          origin,
        };
        break;
      case "math": {
        const format = mathFormat(node);
        result = {
          kind: "displayMath",
          value: stringField(node, "value"),
          format,
          meta: format === "dollar" ? nullableString(node.meta) : undefined,
          origin,
        };
        break;
      }

      case "paragraph":
        result = { kind: "paragraph", children: phrasingChildren(), origin };
        break;
      case "heading":
        result = {
          kind: "heading",
          depth: headingDepth(node.depth),
          children: phrasingChildren(),
          origin,
        };
        break;
      case "code":
        result = {
          kind: "codeBlock",
          value: stringField(node, "value"),
          language: nullableString(node.lang),
          meta: nullableString(node.meta),
          origin,
        };
        break;
      case "thematicBreak":
        result = { kind: "thematicBreak", origin };
        break;
      case "blockquote":
        result = { kind: "blockquote", children: flowChildren(), origin };
        break;
      case "listItem":
        result = {
          kind: "listItem",
          checked: nullableBoolean(node.checked),
          spread: booleanField(node.spread, false),
          children: flowChildren(),
          origin,
        };
        break;
      case "list":
        result = {
          kind: "list",
          ordered: booleanField(node.ordered, false),
          start: nullableNumber(node.start) ?? 1,
          spread: booleanField(node.spread, false),
          children: listItems(children(), node.type),
          origin,
        };
        break;
      case "tableCell":
        result = { kind: "tableCell", children: phrasingChildren(), origin };
        break;
      case "tableRow":
        result = { kind: "tableRow", children: tableCells(children(), node.type), origin };
        break;
      case "table":
        result = {
          kind: "table",
          alignments: tableAlignments(node.align),
          children: tableRows(children(), node.type),
          origin,
        };
        break;
      case "temeljDirectiveLabel":
        result = { kind: "directiveLabel", children: phrasingChildren(), origin };
        break;
      case "textDirective":
      case "leafDirective":
        result = {
          kind: node.type,
          name: stringField(node, "name"),
          attributes: directiveAttributes(node.attributes),
          label: directiveLabel(children("phrasing"), node.type),
          origin,
        };
        break;
      case "containerDirective":
        result = {
          kind: "containerDirective",
          name: stringField(node, "name"),
          attributes: directiveAttributes(node.attributes),
          label: directiveDataLabel(node.data, this),
          children: flowChildren(),
          origin,
        };
        break;
      case "mdxTextExpression":
        result = { kind: "inlineExpression", code: stringField(node, "value"), origin };
        break;
      case "mdxFlowExpression":
        result = { kind: "blockExpression", code: stringField(node, "value"), origin };
        break;
      case "mdxjsEsm":
        result = { kind: "esm", code: stringField(node, "value"), origin };
        break;
      case "mdxJsxTextElement":
        result = {
          kind: "jsxTextElement",
          name: nullableString(node.name),
          attributes: jsxAttributes(node.attributes, this),
          children: phrasingChildren(),
          origin,
        };
        break;
      case "mdxJsxFlowElement":
        result = {
          kind: "jsxFlowElement",
          name: nullableString(node.name),
          attributes: jsxAttributes(node.attributes, this),
          children: flowChildren(),
          origin,
        };
        break;
      default:
        throw new UnifiedBoundaryError(`Unsupported mdast node type: ${node.type}`);
    }

    this.visiting.delete(node);

    return result;
  }

  private htmlToUnist(node: HtmlNode): UnistRecord {
    const base = this.positionBase(node.origin);

    const children = (): UnistRecord[] =>
      htmlChildren(node).map((child) => this.htmlToUnist(child));

    switch (node.kind) {
      case "root":
        return { type: "root", children: children(), ...base };
      case "text":
        return { type: "text", value: node.value, ...base };
      case "raw":
        return { type: "raw", value: node.value, ...base };
      case "comment":
        return { type: "comment", value: node.value, ...base };
      case "doctype":
        return { type: "doctype", ...base };
      case "element":
        return {
          type: "element",
          tagName: node.tagName,
          properties: propertiesToHast(node.attributes, node.tagName === "svg" ? svg : html),
          children: children(),
          ...base,
        };
      case "jsx":
      case "expression":
      case "pending":
      case "unresolvedReference":
        // Rehype sees inert source text. The original node returns when the text is unchanged.
        return {
          type: "text",
          value: htmlText(node),
          data: { [unifiedDataKeys.htmlNode]: this.#owned.push(node) - 1 },
          ...base,
        };
      case "codeBlock":
      case "math":
      case "footnoteReference":
      case "footnoteSection":
        return {
          ...this.htmlToUnist({ ...htmlFallback(node), origin: node.origin }),
          data: { [unifiedDataKeys.htmlNode]: this.#owned.push(node) - 1 },
        };
      default: {
        const exhaustive: never = node;

        return exhaustive;
      }
    }
  }

  private unistToHtml(value: unknown, inSvg: boolean): HtmlNode {
    const node = this.nodeRecord(value);
    const origin = this.origin(node.position);
    let result: HtmlNode;

    switch (node.type) {
      case "root":
        result = {
          kind: "root",
          children: this.nodeChildren(node).map((child) => this.unistToHtml(child, inSvg)),
          origin,
        };
        break;
      case "text":
        result = { kind: "text", value: stringField(node, "value"), origin };
        break;
      case "raw":
        result = { kind: "raw", value: stringField(node, "value"), origin };
        break;
      case "comment":
        result = { kind: "comment", value: stringField(node, "value"), origin };
        break;
      case "doctype":
        result = { kind: "doctype", origin };
        break;
      case "element": {
        const tagName = stringField(node, "tagName");
        const svgElement = inSvg || tagName === "svg";
        const childSvg = svgElement && tagName !== "foreignObject";
        result = {
          kind: "element",
          tagName,
          attributes: propertiesFromHast(node.properties ?? {}, svgElement ? svg : html),
          children: this.nodeChildren(node).map((child) => this.unistToHtml(child, childSvg)),
          origin,
        };
        break;
      }

      default:
        throw new UnifiedBoundaryError(`Unsupported HAST node type: ${node.type}`);
    }

    this.visiting.delete(node);

    return this.restoredHtmlNode(node.data, result);
  }

  /** Restores a semantic node whose inert fallback came back from rehype unchanged. */
  private restoredHtmlNode(data: unknown, result: HtmlNode): HtmlNode {
    const index =
      isPlainObject(data) && unifiedDataKeys.htmlNode in data
        ? data[unifiedDataKeys.htmlNode]
        : undefined;

    const owned = isNumber(index) ? this.#owned.at(index) : undefined;

    if (owned === undefined) {
      return result;
    }

    const unchanged =
      owned.origin?.start === result.origin?.start &&
      owned.origin?.end === result.origin?.end &&
      htmlText(stripSemantic(owned)) === htmlText(result);

    return unchanged ? owned : result;
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

  public positionBase(origin: SourceRange | undefined): UnistOrigin {
    return origin === undefined
      ? {}
      : {
          position: {
            start: this.file.location(origin.start),
            end: this.file.location(origin.end),
          },
        };
  }

  public origin(position: unknown): SourceRange | undefined {
    if (position === undefined) {
      return undefined;
    }

    if (
      !isPlainObject(position) ||
      !("start" in position) ||
      !("end" in position) ||
      !isPlainObject(position.start) ||
      !isPlainObject(position.end)
    ) {
      throw new UnifiedBoundaryError("A returned Unist position is malformed");
    }

    const start = "offset" in position.start ? position.start.offset : undefined;
    const end = "offset" in position.end ? position.end.offset : undefined;

    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      !isNumber(start) ||
      !isNumber(end) ||
      start < 0 ||
      end < start ||
      end > this.file.length
    ) {
      throw new UnifiedBoundaryError("A returned Unist position has invalid UTF-16 offsets");
    }

    return { start, end };
  }
}

function stripSemantic(node: HtmlNode): HtmlNode {
  return node.kind === "codeBlock" ||
    node.kind === "math" ||
    node.kind === "footnoteReference" ||
    node.kind === "footnoteSection"
    ? htmlFallback(node)
    : node;
}

function directiveToUnist(
  type: string,
  node: TextDirectiveNode | LeafDirectiveNode | ContainerDirectiveNode,
  base: UnistOrigin,
  bridge: UnifiedTreeBridge,
): UnistRecord {
  return {
    type,
    name: node.name,
    attributes: Object.fromEntries(node.attributes.map((entry) => [entry.name, entry.value])),
    children:
      node.label === undefined ? [] : node.label.children.map((child) => bridge.mdxToUnist(child)),
    ...base,
  };
}

function jsxElementToUnist(
  type: string,
  node: JsxTextElementNode | JsxFlowElementNode,
  base: UnistOrigin,
  bridge: UnifiedTreeBridge,
): UnistRecord {
  return {
    type,
    name: node.name ?? null,
    attributes: node.attributes.map((attribute) => jsxAttributeToUnist(attribute, bridge)),
    children: node.children.map((child) => bridge.mdxToUnist(child)),
    ...base,
  };
}

function jsxAttributeToUnist(node: JsxAttributeLike, bridge: UnifiedTreeBridge): UnistRecord {
  const base = bridge.positionBase(node.origin);

  if (node.kind === "jsxSpreadAttribute") {
    return { type: "mdxJsxExpressionAttribute", value: `...${node.code}`, ...base };
  }

  const value = jsxAttributeValueToUnist(node);

  return { type: "mdxJsxAttribute", name: node.name, value, ...base };
}

function jsxAttributeValueToUnist(node: JsxAttribute): string | UnistRecord | null {
  if (node.value === undefined) {
    return null;
  }

  return isString(node.value)
    ? node.value
    : { type: "mdxJsxAttributeValueExpression", value: node.value.code };
}

function propertiesToHast(
  attributes: HtmlAttributes,
  schema: Schema,
): Record<string, HtmlAttributeValue> {
  const result: Record<string, HtmlAttributeValue> = Object.create(null);

  for (const [name, value] of Object.entries(attributes)) {
    result[find(schema, name).property] = value;
  }

  return result;
}

function propertiesFromHast(value: unknown, schema: Schema): HtmlAttributes {
  if (!isPlainObject(value)) {
    throw new UnifiedBoundaryError("HAST properties must be an object");
  }

  const result: Record<string, HtmlAttributeValue> = Object.create(null);

  for (const [name, item] of Object.entries(value)) {
    if (item === null || item === undefined) {
      continue;
    }

    if (isBoolean(item) || isString(item) || (isNumber(item) && Number.isFinite(item))) {
      result[find(schema, name).attribute] = item;
      continue;
    }

    if (
      Array.isArray(item) &&
      item.every((entry) => isString(entry) || (isNumber(entry) && Number.isFinite(entry)))
    ) {
      result[find(schema, name).attribute] = [...item];
      continue;
    }

    throw new UnifiedBoundaryError(`Unsupported HAST property value for ${JSON.stringify(name)}`);
  }

  return result;
}

function stringField(node: UnistRecord, name: keyof UnistRecord): string {
  const value = node[name];

  if (!isString(value)) {
    throw new UnifiedBoundaryError(`${node.type}.${name} must be a string`);
  }

  return value;
}

function nullableString(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (!isString(value)) {
    throw new UnifiedBoundaryError("Expected a string or null");
  }

  return value;
}

function nullableBoolean(value: unknown): boolean | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (!isBoolean(value)) {
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

  if (!isNumber(value) || !Number.isSafeInteger(value)) {
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
  return isPlainObject(node.data) &&
    unifiedDataKeys.mathFormat in node.data &&
    node.data[unifiedDataKeys.mathFormat] === "tex"
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

function directiveAttributes(value: unknown): DirectiveAttribute[] {
  if (value === null || value === undefined) {
    return [];
  }

  if (!isPlainObject(value)) {
    throw new UnifiedBoundaryError("Directive attributes must be an object");
  }

  return Object.entries(value).map(([name, item]) => ({
    name,
    value: nullableString(item) ?? "",
  }));
}

function directiveLabel(values: MdxNode[], type: string): DirectiveLabelNode | undefined {
  return values.length === 0
    ? undefined
    : { kind: "directiveLabel", children: phrasing(values, type) };
}

function directiveDataLabel(
  value: unknown,
  bridge: UnifiedTreeBridge,
): DirectiveLabelNode | undefined {
  if (
    !isPlainObject(value) ||
    !(unifiedDataKeys.directiveLabel in value) ||
    value[unifiedDataKeys.directiveLabel] === undefined
  ) {
    return undefined;
  }

  const label = bridge.unistToMdx(value[unifiedDataKeys.directiveLabel]);

  if (label.kind !== "directiveLabel") {
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
      return {
        kind: "jsxSpreadAttribute",
        code: stringField(node, "value").replace(/^\s*\.\.\./u, ""),
        origin,
      };
    }

    if (node.type !== "mdxJsxAttribute") {
      throw new UnifiedBoundaryError(`Unsupported MDX JSX attribute type: ${node.type}`);
    }

    const name = stringField(node, "name");

    if (node.value === null || node.value === undefined || isString(node.value)) {
      return { kind: "jsxAttribute", name, value: node.value ?? undefined, origin };
    }

    const expression = bridge.nodeRecord(node.value);

    if (expression.type !== "mdxJsxAttributeValueExpression") {
      throw new UnifiedBoundaryError("Unsupported MDX JSX attribute value");
    }

    bridge.visiting.delete(expression);

    return {
      kind: "jsxAttribute",
      name,
      value: {
        kind: "jsxAttributeValueExpression",
        code: stringField(expression, "value"),
        origin: bridge.origin(expression.position),
      },
      origin,
    };
  });
}

function phrasing(values: MdxNode[], parent: string): PhrasingContent[] {
  if (!values.every(isPhrasingContent)) {
    throw new UnifiedBoundaryError(`${parent} contains non-phrasing content`);
  }

  return values;
}

function flow(values: MdxNode[], parent: string): FlowContent[] {
  if (!values.every(isFlowContent)) {
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

function isUnistNode(value: unknown): value is UnistRecord {
  return isPlainObject(value) && "type" in value && isString(value.type);
}
