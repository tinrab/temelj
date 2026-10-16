import { isString } from "@temelj/value";

import type { JsxAttributeLike } from "../model.ts";
import type { SourceRange } from "../ranges.ts";
import type { SourceFile } from "../source.ts";

import { CompileError } from "../errors.ts";
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
  const element = parseJavaScriptExpression(authored);
  const fragment = element.type === "JSXFragment";
  const opening = childNode(nodeValue(element, fragment ? "openingFragment" : "openingElement"));
  const closing = childNode(nodeValue(element, fragment ? "closingFragment" : "closingElement"));

  if (opening === undefined) {
    throw CompileError.jsxElementOpeningMissing();
  }

  const name = fragment ? undefined : childNode(nodeValue(opening, "name"));

  if (!fragment && name === undefined) {
    throw CompileError.jsxElementNameMissing();
  }

  return {
    attributes: nodeArray(opening, "attributes").map((attribute) =>
      jsxAttribute(attribute, authored, sourceOffset),
    ),
    children:
      closing === undefined
        ? undefined
        : range(sourceOffset + opening.end, sourceOffset + closing.start),
    name: name === undefined ? undefined : authored.slice(name.start, name.end),
  };
}

function jsxAttribute(
  attribute: JavaScriptNode,
  opening: string,
  sourceOffset: number,
): JsxAttributeLike {
  const origin = range(sourceOffset + attribute.start, sourceOffset + attribute.end);

  if (attribute.type === "JSXSpreadAttribute") {
    const argument = childNode(nodeValue(attribute, "argument"));

    if (argument === undefined) {
      throw CompileError.jsxSpreadArgumentMissing();
    }

    return {
      kind: "jsxSpreadAttribute",
      code: opening.slice(argument.start, argument.end),
      origin,
    };
  }

  const nameNode = childNode(nodeValue(attribute, "name"));
  const name = nameNode === undefined ? undefined : opening.slice(nameNode.start, nameNode.end);
  const value = childNode(nodeValue(attribute, "value"));

  if (name === undefined) {
    throw CompileError.jsxAttributeNameMissing();
  }

  if (value === undefined) {
    return { kind: "jsxAttribute", name, origin };
  }

  if (value.type === "JSXExpressionContainer") {
    const expression = childNode(nodeValue(value, "expression"));

    if (expression === undefined || expression.type === "JSXEmptyExpression") {
      throw CompileError.jsxAttributeExpressionEmpty();
    }

    return {
      kind: "jsxAttribute",
      name,
      value: {
        kind: "jsxAttributeValueExpression",
        code: opening.slice(expression.start, expression.end),
        origin: range(sourceOffset + value.start, sourceOffset + value.end),
      },
      origin,
    };
  }

  // String literals keep JSX semantics, including decoded character references.
  const literal = nodeValue(value, "value");

  if (!isString(literal)) {
    throw CompileError.jsxAttributeExpressionEmpty();
  }

  return { kind: "jsxAttribute", name, value: literal, origin };
}

function range(start: number, end: number): SourceRange {
  return { start, end };
}
