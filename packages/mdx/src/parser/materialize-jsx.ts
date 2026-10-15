import { isString } from "@temelj/value";

import type { JsxAttributeLike } from "../model.ts";
import type { SourceRange } from "../ranges.ts";
import type { SourceFile } from "../source.ts";

import { childNode, nodeArray, nodeValue, type JavaScriptNode } from "../javascript-ast.ts";
import { parseJavaScriptExpression } from "../javascript.ts";

/** Children that start on a new line are Markdown flow content; same-line children are phrasing. */
export function isFlowJsxChildren(file: SourceFile, range: SourceRange): boolean {
  return /^[ \t]*(?:\r\n|\r|\n)/u.test(file.slice(range));
}

export interface JsxParts {
  readonly attributes: readonly JsxAttributeLike[];
  readonly children: SourceRange | undefined;
  readonly name: string | undefined;
}

export function jsxParts(authored: string, sourceOffset: number): JsxParts {
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

function range(start: number, end: number): SourceRange {
  return { start, end };
}
