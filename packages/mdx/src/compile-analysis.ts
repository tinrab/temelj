import { isString } from "@temelj/value";

import type { HtmlNode, HtmlRootNode } from "./html.ts";
import type { JavaScriptJsxContext } from "./javascript-jsx.ts";
import type { DocumentNode, SourceRange } from "./model.ts";
import type { SourceFile } from "./source.ts";

import { CompileError } from "./errors.ts";
import { htmlChildren, htmlFallback } from "./html.ts";
import {
  childNode,
  collectPatternNames,
  nodeArray,
  nodeValue,
  type JavaScriptNode,
} from "./javascript-ast.ts";
import { analyzeJavaScriptExpression, transformJavaScriptProgram } from "./javascript-jsx.ts";
import { hasJavaScriptToken, parseJavaScriptProgram } from "./javascript.ts";
import { recordJsxReference, resolveJsxName } from "./jsx-reference.ts";

/** JavaScript scope shared by analysis and emission. Analysis records references into it. */
export interface CompileScope extends JavaScriptJsxContext {
  readonly file: SourceFile | undefined;
  readonly inScope: ReadonlySet<string>;
  readonly missingReferences: Map<string, boolean>;
  readonly referencedComponents: Set<string>;
}

export interface CompiledEsm {
  readonly code: string;
  readonly origin?: SourceRange;
}

export interface CompileAnalysis {
  readonly esm: readonly CompiledEsm[];
  readonly hasInternalLayout: boolean;
  readonly intrinsicTags: ReadonlySet<string>;
  readonly scope: CompileScope;
}

export function analyzeDocument(
  document: DocumentNode,
  content: HtmlRootNode,
  options: Readonly<{ development?: boolean; sourceName?: string; source?: SourceFile }>,
): CompileAnalysis {
  const inScope = new Set<string>();
  const authoredEsm: CompiledEsm[] = [];

  for (const child of document.children) {
    if (child.kind === "esm") {
      collectProgramBindings(parseJavaScriptProgram(child.code), inScope);
      authoredEsm.push({ code: child.code, origin: child.origin });
    }
  }

  const scope: CompileScope = {
    development: options.development ?? false,
    file: options.source,
    inScope,
    missingReferences: new Map(),
    referencedComponents: new Set(),
    sourceName: options.sourceName ?? options.source?.name ?? "source.mdx",
  };

  // ESM may render JSX, but its references never become required content components.
  const esmScope: CompileScope = {
    ...scope,
    missingReferences: new Map(),
    referencedComponents: new Set(),
  };

  let hasInternalLayout = false;

  const esm = authoredEsm.map((entry): CompiledEsm => {
    const jsx = transformJavaScriptProgram(
      entry.code,
      esmScope,
      entry.origin === undefined || scope.file === undefined
        ? undefined
        : { file: scope.file, offset: entry.origin.start },
    );

    const transformed = transformEsm(jsx, parseJavaScriptProgram(jsx));

    if (transformed.hasDefaultExport) {
      if (hasInternalLayout) {
        CompileError.multipleDefaultExports();
      }

      hasInternalLayout = true;
    }

    return { code: transformed.code, origin: entry.origin };
  });

  const intrinsicTags = new Set<string>();
  analyzeContent(content, scope, intrinsicTags);

  return { esm, hasInternalLayout, intrinsicTags, scope };
}

function analyzeContent(node: HtmlNode, scope: CompileScope, intrinsicTags: Set<string>): void {
  switch (node.kind) {
    case "element":
      intrinsicTags.add(node.tagName);
      break;
    case "expression":
      if (hasJavaScriptToken(node.code)) {
        analyzeJavaScriptExpression(node.code, scope);
      }

      break;
    case "jsx":
      recordJsxReference(resolveJsxName(node.node.name), scope);

      for (const attribute of node.node.attributes) {
        if (attribute.kind === "jsxSpreadAttribute") {
          analyzeJavaScriptExpression(attribute.code, scope);
        } else if (attribute.value !== undefined && !isString(attribute.value)) {
          analyzeJavaScriptExpression(attribute.value.code, scope);
        }
      }

      break;
    case "codeBlock":
    case "math":
    case "footnoteReference":
    case "footnoteSection":
      // Compiled output renders the same fallback elements as HTML.
      analyzeContent(htmlFallback(node), scope, intrinsicTags);

      return;
    default:
      break;
  }

  for (const child of htmlChildren(node)) {
    analyzeContent(child, scope, intrinsicTags);
  }
}

interface TransformedEsm {
  readonly code: string;
  readonly hasDefaultExport: boolean;
}

function transformEsm(source: string, program: JavaScriptNode): TransformedEsm {
  const body = nodeArray(program, "body");
  let cursor = 0;
  let hasDefaultExport = false;
  const result: string[] = [];

  for (const statement of body) {
    result.push(source.slice(cursor, statement.start));

    if (statement.type === "ExportDefaultDeclaration") {
      hasDefaultExport = true;
      const declaration = childNode(nodeValue(statement, "declaration"));

      if (declaration === undefined) {
        CompileError.defaultExportDeclarationMissing();
      }

      result.push(`const Layout = (${source.slice(declaration.start, declaration.end)});`);
    } else if (statement.type === "ExportNamedDeclaration") {
      const transformed = transformNamedDefaultExport(source, statement);

      if (transformed === undefined) {
        result.push(source.slice(statement.start, statement.end));
      } else {
        hasDefaultExport = true;
        result.push(transformed);
      }
    } else {
      result.push(source.slice(statement.start, statement.end));
    }

    cursor = statement.end;
  }

  result.push(source.slice(cursor));

  return { code: result.join(""), hasDefaultExport };
}

function transformNamedDefaultExport(
  source: string,
  statement: JavaScriptNode,
): string | undefined {
  const specifiers = nodeArray(statement, "specifiers");

  const layout = specifiers.find(
    (specifier) => identifierValue(childNode(nodeValue(specifier, "exported"))) === "default",
  );

  if (layout === undefined) {
    return undefined;
  }

  const local = childNode(nodeValue(layout, "local"));
  const localName = identifierValue(local);

  if (local === undefined || localName === undefined) {
    CompileError.defaultExportBindingMissing();
  }

  const from = childNode(nodeValue(statement, "source"));

  const layoutDeclaration =
    from === undefined
      ? `const Layout = ${localName};`
      : `import {${localName} as Layout} from ${source.slice(from.start, from.end)};`;

  const remaining = specifiers.filter((specifier) => specifier !== layout);

  if (remaining.length === 0) {
    return layoutDeclaration;
  }

  const suffix =
    from === undefined
      ? ";"
      : ` from ${source.slice(from.start, statement.end).replace(/;?$/u, ";")}`;

  return `${layoutDeclaration}\nexport {${remaining
    .map((specifier) => source.slice(specifier.start, specifier.end))
    .join(", ")}}${suffix}`;
}

function collectProgramBindings(program: JavaScriptNode, names: Set<string>): void {
  for (const statement of nodeArray(program, "body")) {
    if (statement.type === "ImportDeclaration") {
      for (const specifier of nodeArray(statement, "specifiers")) {
        collectPatternNames(childNode(nodeValue(specifier, "local")), names);
      }
    } else if (statement.type === "ExportNamedDeclaration") {
      collectDeclarationNames(childNode(nodeValue(statement, "declaration")), names);
    } else {
      collectDeclarationNames(statement, names);
    }
  }
}

function identifierValue(node: JavaScriptNode | undefined): string | undefined {
  if (node === undefined) {
    return undefined;
  }

  const name = nodeValue(node, "name");
  const value = nodeValue(node, "value");

  return isString(name) ? name : isString(value) ? value : undefined;
}

function collectDeclarationNames(node: JavaScriptNode | undefined, names: Set<string>): void {
  if (node === undefined) {
    return;
  }

  if (node.type === "VariableDeclaration") {
    for (const declaration of nodeArray(node, "declarations")) {
      collectPatternNames(childNode(nodeValue(declaration, "id")), names);
    }
  } else if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") {
    collectPatternNames(childNode(nodeValue(node, "id")), names);
  }
}
