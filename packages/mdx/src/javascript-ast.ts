import { isString, isNumber, isBoolean, isBigInt, isObject } from "@temelj/value";

export interface JavaScriptNode {
  readonly end: number;
  readonly start: number;
  readonly type: string;
}

export type JavaScriptField =
  | JavaScriptNode
  | string
  | number
  | boolean
  | bigint
  | RegExp
  | null
  | undefined;

export function isJavaScriptNode(value: unknown): value is JavaScriptNode {
  return (
    isObject(value) &&
    "type" in value &&
    isString(value.type) &&
    "start" in value &&
    isNumber(value.start) &&
    "end" in value &&
    isNumber(value.end)
  );
}

export function childNode(value: JavaScriptField): JavaScriptNode | undefined {
  return isObject(value) && !(value instanceof RegExp) ? value : undefined;
}

export function nodeValue(node: JavaScriptNode, key: string): JavaScriptField {
  const value: unknown = Object.getOwnPropertyDescriptor(node, key)?.value;

  if (
    value === null ||
    value === undefined ||
    isJavaScriptNode(value) ||
    isString(value) ||
    isNumber(value) ||
    isBoolean(value) ||
    isBigInt(value) ||
    value instanceof RegExp
  ) {
    return value;
  }

  return undefined;
}

export function nodeArray(node: JavaScriptNode, key: string): JavaScriptNode[] {
  const value: unknown = Object.getOwnPropertyDescriptor(node, key)?.value;

  return Array.isArray(value) ? value.filter(isJavaScriptNode) : [];
}

export function collectPatternNames(node: JavaScriptNode | undefined, names: Set<string>): void {
  if (node === undefined) {
    return;
  }

  if (node.type === "Identifier") {
    const name = nodeValue(node, "name");

    if (isString(name)) {
      names.add(name);
    }
  } else if (node.type === "RestElement") {
    collectPatternNames(childNode(nodeValue(node, "argument")), names);
  } else if (node.type === "AssignmentPattern") {
    collectPatternNames(childNode(nodeValue(node, "left")), names);
  } else if (node.type === "ArrayPattern") {
    for (const element of nodeArray(node, "elements")) {
      collectPatternNames(element, names);
    }
  } else if (node.type === "ObjectPattern") {
    for (const property of nodeArray(node, "properties")) {
      collectPatternNames(
        childNode(nodeValue(property, "value")) ?? childNode(nodeValue(property, "argument")),
        names,
      );
    }
  }
}

export function javascriptPropertyName(name: string): string {
  return /^[$A-Z_a-z][$\w]*$/u.test(name) ? name : JSON.stringify(name);
}

export function javascriptChildren(node: JavaScriptNode): JavaScriptNode[] {
  return nestedNodes(Object.values(node));
}

function nestedNodes(values: readonly unknown[]): JavaScriptNode[] {
  return values.flatMap((value) =>
    Array.isArray(value) ? nestedNodes(value) : isJavaScriptNode(value) ? [value] : [],
  );
}
