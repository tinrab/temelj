import { isPlainObject } from "@temelj/value";

export interface JavaScriptNode {
  readonly end: number;
  readonly start: number;
  readonly type: string;
}

export function isJavaScriptNode(value: unknown): value is JavaScriptNode {
  return (
    isPlainObject(value) &&
    typeof value.type === "string" &&
    typeof value.start === "number" &&
    typeof value.end === "number"
  );
}

export function childNode(value: unknown): JavaScriptNode | undefined {
  return isJavaScriptNode(value) ? value : undefined;
}

export function nodeValue(node: JavaScriptNode, key: string): unknown {
  return Reflect.get(node, key);
}

export function nodeArray(node: object, key: string): JavaScriptNode[] {
  const value: unknown = Reflect.get(node, key);
  return Array.isArray(value) ? value.flatMap((item: unknown) => childNode(item) ?? []) : [];
}

export function collectPatternNames(node: JavaScriptNode | undefined, names: Set<string>): void {
  if (node === undefined) {
    return;
  }
  if (node.type === "Identifier") {
    const name = nodeValue(node, "name");
    if (typeof name === "string") {
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
