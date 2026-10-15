import { isString } from "@temelj/value";

import type { FormatContext, FormatInfo } from "./format-context.ts";
import type {
  JsxAttribute,
  JsxAttributeLike,
  JsxFlowElementNode,
  JsxTextElementNode,
} from "./model.ts";

import { indentLines } from "./format-context.ts";

// MDX JSX elements and their attributes.

function formatJsxAttribute(context: FormatContext, node: JsxAttribute): string {
  if (node.value === undefined) {
    return node.name;
  }

  if (!isString(node.value)) {
    return `${node.name}={${indentExpression(node.value.code)}}`;
  }

  const quote = context.options.quote ?? '"';

  return `${node.name}=${quote}${escapeJsxAttribute(node.value, quote)}${quote}`;
}

export function formatJsxTextElement(
  context: FormatContext,
  node: JsxTextElementNode,
  info: FormatInfo,
): string {
  const opening = formatJsxOpening(context, node.name, node.attributes, node.children.length === 0);

  if (node.name !== undefined && node.children.length === 0) {
    return opening;
  }

  const exit = context.enter("phrasing");
  const body = context.phrasing(node.children, { ...info, after: "<", before: ">" });
  exit();

  return `${opening}${body}</${node.name ?? ""}>`;
}

export function formatJsxFlowElement(
  context: FormatContext,
  node: JsxFlowElementNode,
  info: FormatInfo,
): string {
  const opening = formatJsxOpening(context, node.name, node.attributes, node.children.length === 0);

  if (node.name !== undefined && node.children.length === 0) {
    return opening;
  }

  if (node.children.length === 0) {
    return `${opening}</>`;
  }

  const body = indentLines(
    context.flow(node.children, { ...info, after: "\n", before: "\n" }),
    (line, blank) => (blank ? "" : `  ${line}`),
  );

  return `${opening}\n${body}\n</${node.name ?? ""}>`;
}

function formatJsxOpening(
  context: FormatContext,
  name: string | undefined,
  attributes: readonly JsxAttributeLike[],
  empty: boolean,
): string {
  if (name === undefined && attributes.length > 0) {
    throw new Error("A JSX fragment cannot have attributes");
  }

  const values = attributes.map((attribute) =>
    attribute.kind === "jsxAttribute"
      ? formatJsxAttribute(context, attribute)
      : `{...${indentExpression(attribute.code)}}`,
  );

  const suffix = name !== undefined && empty ? " />" : ">";

  return `<${name ?? ""}${values.length === 0 ? "" : ` ${values.join(" ")}`}${suffix}`;
}

export function indentExpression(value: string): string {
  return value.replace(/\r\n?|\n/gu, (ending) => `${ending}  `);
}

function escapeJsxAttribute(value: string, quote: '"' | "'"): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(quote, quote === '"' ? "&quot;" : "&#x27;");
}
