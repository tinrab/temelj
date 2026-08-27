import type { SourceFile } from "./model.ts";

import { CompileError } from "./errors.ts";
import {
  childNode,
  collectPatternNames,
  javascriptPropertyName,
  nodeArray,
  nodeValue,
  type JavaScriptNode,
} from "./javascript-ast.ts";
import { parseJavaScriptExpression, parseJavaScriptProgram } from "./javascript.ts";
import { recordJsxReference, resolveJsxName, type JsxReferenceContext } from "./jsx-reference.ts";

export interface JavaScriptJsxContext extends JsxReferenceContext {
  readonly development: boolean;
  readonly inScope: ReadonlySet<string>;
  readonly intrinsicTags: Set<string>;
  readonly missingReferences: Map<string, boolean>;
  readonly referencedComponents: Set<string>;
  readonly sourceName: string;
}

export function analyzeJavaScriptExpression(source: string, context: JavaScriptJsxContext): void {
  analyzeJsxReferences(parseJavaScriptExpression(source), context);
}

export function analyzeJavaScriptProgram(source: string, context: JavaScriptJsxContext): void {
  analyzeJsxReferences(parseJavaScriptProgram(source), context);
}

export interface JavaScriptSourceOrigin {
  readonly file: SourceFile;
  readonly offset: number;
}

export function transformJavaScriptExpression(
  source: string,
  context: JavaScriptJsxContext,
  origin?: JavaScriptSourceOrigin,
): string {
  const root = parseJavaScriptExpression(source);
  return transformNodeSource(source, root, { ...withLocalBindings(root, context), origin });
}

export function transformJavaScriptProgram(
  source: string,
  context: JavaScriptJsxContext,
  origin?: JavaScriptSourceOrigin,
): string {
  const root = parseJavaScriptProgram(source);
  return transformNodeSource(source, root, { ...withLocalBindings(root, context), origin });
}

export function javascriptExpressionUsesAwait(source: string): boolean {
  return containsAwait(parseJavaScriptExpression(source));
}

interface JavaScriptTransformContext extends JavaScriptJsxContext {
  readonly origin?: JavaScriptSourceOrigin;
}

function transformNodeSource(
  source: string,
  root: JavaScriptNode,
  context: JavaScriptTransformContext,
): string {
  if (root.type === "JSXElement" || root.type === "JSXFragment") {
    return emitJsx(root, source, context);
  }

  const jsx = outerJsxNodes(root);
  if (jsx.length === 0) {
    return source.slice(root.start, root.end);
  }
  let cursor = root.start;
  const chunks: string[] = [];
  for (const node of jsx.sort((left, right) => left.start - right.start)) {
    chunks.push(source.slice(cursor, node.start), emitJsx(node, source, context));
    cursor = node.end;
  }
  chunks.push(source.slice(cursor, root.end));
  return chunks.join("");
}

function emitJsx(
  node: JavaScriptNode,
  source: string,
  context: JavaScriptTransformContext,
): string {
  if (node.type === "JSXFragment") {
    return emitCall(
      "_Fragment",
      jsxChildren(nodeArray(node, "children"), source, context),
      [],
      node,
      context,
    );
  }

  const opening = childNode(nodeValue(node, "openingElement"));
  if (opening === undefined) {
    CompileError.jsxElementOpeningMissing();
  }
  const name = childNode(nodeValue(opening, "name"));
  if (name === undefined) {
    CompileError.jsxElementNameMissing();
  }
  const tag = jsxTag(name);
  const properties = jsxAttributes(nodeArray(opening, "attributes"), source, context);
  const children = jsxChildren(nodeArray(node, "children"), source, context);
  return emitCall(tag, children, properties, node, context);
}

function emitCall(
  tag: string,
  children: readonly string[],
  properties: readonly string[],
  node: JavaScriptNode,
  context: JavaScriptTransformContext,
): string {
  const entries = [...properties];
  if (children.length === 1) {
    entries.push(`children:${children[0]}`);
  } else if (children.length > 1) {
    entries.push(`children:[${children.join(", ")}]`);
  }
  const propertiesCode = `{${entries.join(", ")}}`;
  return context.development
    ? `_jsxDEV(${tag}, ${propertiesCode}, undefined, ${children.length > 1}, ${javascriptSource(node, context)}, undefined)`
    : `${children.length > 1 ? "_jsxs" : "_jsx"}(${tag}, ${propertiesCode})`;
}

function jsxAttributes(
  attributes: readonly JavaScriptNode[],
  source: string,
  context: JavaScriptTransformContext,
): string[] {
  return attributes.map((attribute) => {
    if (attribute.type === "JSXSpreadAttribute") {
      const argument = childNode(nodeValue(attribute, "argument"));
      if (argument === undefined) {
        CompileError.jsxSpreadArgumentMissing();
      }
      return `...(${transformNodeSource(source, argument, context)})`;
    }
    const nameNode = childNode(nodeValue(attribute, "name"));
    if (nameNode === undefined) {
      CompileError.jsxAttributeNameMissing();
    }
    const name = jsxName(nameNode);
    const value = childNode(nodeValue(attribute, "value"));
    if (value === undefined) {
      return `${javascriptPropertyName(name)}:true`;
    }
    if (value.type === "Literal") {
      return `${javascriptPropertyName(name)}:${JSON.stringify(nodeValue(value, "value"))}`;
    }
    if (value.type === "JSXExpressionContainer") {
      const expression = childNode(nodeValue(value, "expression"));
      if (expression === undefined || expression.type === "JSXEmptyExpression") {
        CompileError.jsxAttributeExpressionEmpty();
      }
      return `${javascriptPropertyName(name)}:${transformNodeSource(source, expression, context)}`;
    }
    return `${javascriptPropertyName(name)}:${emitJsx(value, source, context)}`;
  });
}

function jsxChildren(
  children: readonly JavaScriptNode[],
  source: string,
  context: JavaScriptTransformContext,
): string[] {
  const result: string[] = [];
  for (const child of children) {
    if (child.type === "JSXText") {
      const value = nodeValue(child, "value");
      const text = normalizeJsxText(typeof value === "string" ? value : "");
      if (text !== "") {
        result.push(JSON.stringify(text));
      }
    } else if (child.type === "JSXExpressionContainer") {
      const expression = childNode(nodeValue(child, "expression"));
      if (expression !== undefined && expression.type !== "JSXEmptyExpression") {
        result.push(transformNodeSource(source, expression, context));
      }
    } else if (child.type === "JSXSpreadChild") {
      const expression = childNode(nodeValue(child, "expression"));
      if (expression !== undefined) {
        result.push(`...(${transformNodeSource(source, expression, context)})`);
      }
    } else {
      result.push(emitJsx(child, source, context));
    }
  }
  return result;
}

function jsxTag(node: JavaScriptNode): string {
  return resolveJsxName(jsxName(node)).expression;
}

function javascriptSource(node: JavaScriptNode, context: JavaScriptTransformContext): string {
  if (context.origin === undefined) {
    return "undefined";
  }
  const location = context.origin.file.location(context.origin.offset + node.start);
  return `{fileName:${JSON.stringify(context.sourceName)},lineNumber:${location.line},columnNumber:${location.column}}`;
}

function jsxName(node: JavaScriptNode): string {
  if (node.type === "JSXIdentifier") {
    const name = nodeValue(node, "name");
    if (typeof name !== "string") {
      CompileError.jsxIdentifierNameMissing();
    }
    return name;
  }
  if (node.type === "JSXMemberExpression") {
    const object = childNode(nodeValue(node, "object"));
    const property = childNode(nodeValue(node, "property"));
    if (object === undefined || property === undefined) {
      CompileError.jsxMemberExpressionIncomplete();
    }
    return `${jsxName(object)}.${jsxName(property)}`;
  }
  if (node.type === "JSXNamespacedName") {
    const namespace = childNode(nodeValue(node, "namespace"));
    const name = childNode(nodeValue(node, "name"));
    if (namespace === undefined || name === undefined) {
      CompileError.jsxNamespaceIncomplete();
    }
    return `${jsxName(namespace)}:${jsxName(name)}`;
  }
  CompileError.unsupportedJsxName(node.type);
}

function normalizeJsxText(value: string): string {
  const lines = value.replaceAll("\t", " ").split(/\r\n?|\n/u);
  let lastNonEmptyLine = 0;
  for (let index = 0; index < lines.length; index++) {
    if (/[^ ]/u.test(lines[index])) {
      lastNonEmptyLine = index;
    }
  }
  let result = "";
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index];
    if (index > 0) {
      line = line.replace(/^ +/u, "");
    }
    if (index < lines.length - 1) {
      line = line.replace(/ +$/u, "");
    }
    if (line === "") {
      continue;
    }
    result += line;
    if (index !== lastNonEmptyLine) {
      result += " ";
    }
  }
  return result;
}

function outerJsxNodes(root: JavaScriptNode): JavaScriptNode[] {
  const result: JavaScriptNode[] = [];
  for (const value of Object.values(root)) {
    collectOuterJsx(value, result);
  }
  return result;
}

function analyzeJsxReferences(root: JavaScriptNode, context: JavaScriptJsxContext): void {
  collectJsxReferences(root, withLocalBindings(root, context));
}

function collectJsxReferences(value: unknown, context: JavaScriptJsxContext): void {
  if (Array.isArray(value)) {
    for (const child of value) {
      collectJsxReferences(child, context);
    }
    return;
  }
  const node = childNode(value);
  if (node === undefined) {
    return;
  }
  if (node.type === "JSXElement") {
    const opening = childNode(nodeValue(node, "openingElement"));
    const name = opening === undefined ? undefined : childNode(nodeValue(opening, "name"));
    if (name === undefined) {
      CompileError.jsxElementNameMissing();
    }
    recordJsxReference(resolveJsxName(jsxName(name)), context);
  }
  for (const child of Object.values(node)) {
    collectJsxReferences(child, context);
  }
}

function collectOuterJsx(value: unknown, result: JavaScriptNode[]): void {
  if (Array.isArray(value)) {
    for (const child of value) {
      collectOuterJsx(child, result);
    }
    return;
  }
  const node = childNode(value);
  if (node === undefined) {
    return;
  }
  if (node.type === "JSXElement" || node.type === "JSXFragment") {
    result.push(node);
    return;
  }
  for (const child of Object.values(node)) {
    collectOuterJsx(child, result);
  }
}

function withLocalBindings(
  root: JavaScriptNode,
  context: JavaScriptJsxContext,
): JavaScriptJsxContext {
  const names = new Set(context.inScope);
  collectBindings(root, names);
  return { ...context, inScope: names };
}

function collectBindings(value: unknown, names: Set<string>): void {
  if (Array.isArray(value)) {
    for (const child of value) {
      collectBindings(child, names);
    }
    return;
  }
  const node = childNode(value);
  if (node === undefined) {
    return;
  }
  if (node.type === "VariableDeclarator") {
    collectPatternNames(childNode(nodeValue(node, "id")), names);
  } else if (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ClassDeclaration" ||
    node.type === "ClassExpression"
  ) {
    collectPatternNames(childNode(nodeValue(node, "id")), names);
  }
  if (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  ) {
    for (const parameter of nodeArray(node, "params")) {
      collectPatternNames(parameter, names);
    }
  }
  if (node.type === "ImportDeclaration") {
    for (const specifier of nodeArray(node, "specifiers")) {
      collectPatternNames(childNode(nodeValue(specifier, "local")), names);
    }
  }
  for (const child of Object.values(node)) {
    collectBindings(child, names);
  }
}

function containsAwait(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((child) => containsAwait(child));
  }
  const node = childNode(value);
  if (node === undefined) {
    return false;
  }
  if (node.type === "AwaitExpression") {
    return true;
  }
  if (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  ) {
    return false;
  }
  return Object.values(node).some((child) => containsAwait(child));
}
