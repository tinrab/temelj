import { isString } from "@temelj/value";

import type { CompileAnalysis, CompileScope } from "./compile-analysis.ts";
import type {
  HtmlAttributes,
  HtmlAttributeValue,
  HtmlCodeBlockNode,
  HtmlElementNode,
  HtmlJsxNode,
  HtmlMathNode,
  HtmlNode,
  HtmlRootNode,
} from "./html.ts";
import type { JsxAttributeLike } from "./model.ts";
import type { SourceRange } from "./ranges.ts";
import type { CodeWriter } from "./source-map.ts";

import { htmlFallback, isHtmlAttributeList, pendingFallback } from "./html.ts";
import { javascriptPropertyName } from "./javascript-ast.ts";
import { javascriptExpressionUsesAwait, transformJavaScriptExpression } from "./javascript-jsx.ts";
import { hasJavaScriptToken } from "./javascript.ts";
import { resolveJsxName } from "./jsx-reference.ts";

type Property = readonly [name: string, value: string];

/** Containers whose whitespace-only text children are not valid DOM. */
const tableContainers: ReadonlySet<string> = new Set([
  "colgroup",
  "table",
  "tbody",
  "tfoot",
  "thead",
  "tr",
]);

const reactPropertyNames: ReadonlyMap<string, string> = new Map([
  ["class", "className"],
  ["for", "htmlFor"],
  ["tabindex", "tabIndex"],
]);

/** Emits the content expression for a lowered document. */
export function emitContent(
  writer: CodeWriter,
  content: HtmlRootNode,
  analysis: CompileAnalysis,
): void {
  const children = emittedChildren(content.children, false);

  if (children.length === 1) {
    emitNode(writer, children[0], analysis.scope);
  } else {
    emitCall(
      writer,
      analysis.scope.names.get("_Fragment"),
      [],
      content.origin,
      analysis.scope,
      children,
    );
  }
}

export function contentUsesAwait(node: HtmlNode): boolean {
  if (node.kind === "expression") {
    return hasJavaScriptToken(node.code) && javascriptExpressionUsesAwait(node.code);
  }

  if (node.kind === "jsx" && node.attributes.some(attributeUsesAwait)) {
    return true;
  }

  return "children" in node && node.children.some(contentUsesAwait);
}

function attributeUsesAwait(attribute: JsxAttributeLike): boolean {
  const code =
    attribute.kind === "jsxSpreadAttribute"
      ? attribute.code
      : attribute.value === undefined || isString(attribute.value)
        ? undefined
        : attribute.value.code;

  return code !== undefined && javascriptExpressionUsesAwait(code);
}

function emitNode(writer: CodeWriter, node: HtmlNode, scope: CompileScope): void {
  switch (node.kind) {
    case "text":
    case "raw":
      writer.write(JSON.stringify(node.value), node.origin);

      return;
    case "expression":
      writer.write(
        `(${transformJavaScriptExpression(node.code, scope, javascriptOrigin(node.origin, scope, 1))})`,
        node.origin,
      );

      return;
    case "jsx":
      emitJsx(writer, node, scope);

      return;
    case "element":
      emitElement(writer, node, scope);

      return;
    case "root":
      emitCall(
        writer,
        scope.names.get("_Fragment"),
        [],
        node.origin,
        scope,
        emittedChildren(node.children, false),
      );

      return;
    case "codeBlock":
      emitCodeBlock(writer, node, scope);

      return;
    case "math":
      emitMath(writer, node, scope);

      return;
    case "footnoteReference":
    case "footnoteSection":
      emitElement(writer, { ...htmlFallback(node), origin: node.origin }, scope);

      return;
    case "comment":
    case "doctype":
      writer.write("null");

      return;
    case "pending":
    case "unresolvedReference":
      emitCall(
        writer,
        scope.names.get("_Fragment"),
        [],
        node.origin,
        scope,
        emittedChildren(pendingFallback(node), false),
      );

      return;
    default: {
      const exhaustive: never = node;

      return exhaustive;
    }
  }
}

function emitElement(writer: CodeWriter, node: HtmlElementNode, scope: CompileScope): void {
  emitCall(
    writer,
    `${scope.names.get("_components")}[${JSON.stringify(node.tagName)}]`,
    elementProperties(node.attributes),
    node.origin,
    scope,
    emittedChildren(node.children, tableContainers.has(node.tagName)),
  );
}

function emitJsx(writer: CodeWriter, node: HtmlJsxNode, scope: CompileScope): void {
  emitCall(
    writer,
    node.name === undefined ? scope.names.get("_Fragment") : resolveJsxName(node.name).expression,
    jsxProperties(node.attributes, scope),
    node.origin,
    scope,
    emittedChildren(node.children, false),
  );
}

function emitCodeBlock(writer: CodeWriter, node: HtmlCodeBlockNode, scope: CompileScope): void {
  const descriptor = JSON.stringify({
    kind: "codeBlock",
    code: node.code,
    language: node.language,
    meta: node.meta,
    origin: node.origin,
  });

  const component = `${scope.names.get("_components")}.codeBlock`;
  writer.write(`(${component} ? `);
  emitCall(
    writer,
    component,
    [
      ["code", JSON.stringify(node.code)],
      ["language", JSON.stringify(node.language)],
      ...(node.meta === undefined ? [] : [["meta", JSON.stringify(node.meta)] as const]),
      ["node", descriptor],
      ["status", JSON.stringify("complete")],
    ],
    node.origin,
    scope,
    [],
  );
  writer.write(" : ");
  emitElement(writer, { ...htmlFallback(node), origin: node.origin }, scope);
  writer.write(")");
}

function emitMath(writer: CodeWriter, node: HtmlMathNode, scope: CompileScope): void {
  const component = `${scope.names.get("_components")}.mathFormula`;
  writer.write(`(${component} ? `);
  emitCall(
    writer,
    component,
    [
      ["source", JSON.stringify(node.source)],
      ["style", JSON.stringify(node.style)],
      ...(node.meta === undefined ? [] : [["meta", JSON.stringify(node.meta)] as const]),
    ],
    node.origin,
    scope,
    [],
  );
  writer.write(" : ");
  emitElement(writer, { ...htmlFallback(node), origin: node.origin }, scope);
  writer.write(")");
}

function emitCall(
  writer: CodeWriter,
  tag: string,
  properties: readonly Property[],
  origin: SourceRange | undefined,
  scope: CompileScope,
  children: readonly HtmlNode[],
): void {
  const multiple = children.length > 1;

  writer.write(
    `${scope.names.get(scope.development ? "_jsxDEV" : multiple ? "_jsxs" : "_jsx")}(`,
    origin,
  );
  writer.write(`${tag}, {`);

  properties.forEach(([name, value], index) => {
    writer.write(index > 0 ? ", " : "");
    writer.write(name === "..." ? `...${value}` : `${javascriptPropertyName(name)}:${value}`);
  });

  if (children.length > 0) {
    writer.write(properties.length > 0 ? ", children:" : "children:");

    if (multiple) {
      writer.write("[");
    }

    children.forEach((child, index) => {
      writer.write(index > 0 ? ", " : "");
      emitNode(writer, child, scope);
    });

    if (multiple) {
      writer.write("]");
    }
  }

  writer.write("}");

  if (scope.development) {
    writer.write(`, undefined, ${multiple}, ${developmentSource(origin, scope)}, undefined`);
  }

  writer.write(")");
}

/** Drops nodes that render nothing, and whitespace where the DOM forbids text. */
function emittedChildren(children: readonly HtmlNode[], dropWhitespace: boolean): HtmlNode[] {
  return children.filter((child) => {
    switch (child.kind) {
      case "comment":
      case "doctype":
        return false;
      case "expression":
        return hasJavaScriptToken(child.code);
      case "text":
        return !dropWhitespace || child.value.trim() !== "";
      default:
        return true;
    }
  });
}

function elementProperties(attributes: HtmlAttributes): Property[] {
  return Object.entries(attributes).flatMap(([name, value]): Property[] =>
    value === false ? [] : [[reactPropertyName(name), attributeValue(value)]],
  );
}

function reactPropertyName(name: string): string {
  return name.startsWith("data-") || name.startsWith("aria-")
    ? name
    : (reactPropertyNames.get(name) ?? name);
}

function attributeValue(value: HtmlAttributeValue): string {
  return JSON.stringify(isHtmlAttributeList(value) ? value.join(" ") : value);
}

function jsxProperties(attributes: readonly JsxAttributeLike[], scope: CompileScope): Property[] {
  return attributes.map((attribute): Property => {
    if (attribute.kind === "jsxSpreadAttribute") {
      return [
        "...",
        `(${transformJavaScriptExpression(
          attribute.code,
          scope,
          javascriptOrigin(attribute.origin, scope, "{...".length),
        )})`,
      ];
    }

    const value = attribute.value;

    return [
      attribute.name,
      value === undefined
        ? "true"
        : isString(value)
          ? JSON.stringify(value)
          : `(${transformJavaScriptExpression(
              value.code,
              scope,
              javascriptOrigin(value.origin, scope, "{".length),
            )})`,
    ];
  });
}

function javascriptOrigin(
  origin: SourceRange | undefined,
  scope: CompileScope,
  relativeOffset: number,
): { readonly file: NonNullable<CompileScope["file"]>; readonly offset: number } | undefined {
  return origin === undefined || scope.file === undefined
    ? undefined
    : { file: scope.file, offset: origin.start + relativeOffset };
}

function developmentSource(origin: SourceRange | undefined, scope: CompileScope): string {
  if (origin === undefined || scope.file === undefined) {
    return "undefined";
  }

  const location = scope.file.location(origin.start);

  return `{fileName:${JSON.stringify(scope.sourceName)},lineNumber:${location.line},columnNumber:${location.column}}`;
}
