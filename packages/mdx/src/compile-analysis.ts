import { isString } from "@temelj/value";

import type { CompileOutputFormat } from "./compiler.ts";
import type { HtmlNode, HtmlRootNode } from "./html.ts";
import type { JavaScriptJsxContext } from "./javascript-jsx.ts";
import type { DocumentNode } from "./model.ts";
import type { SourceFile } from "./source.ts";

import {
  collectEsmBindings,
  emitEsm,
  parseEsm,
  type EmittedEsm,
  type ParsedEsm,
} from "./compile-esm.ts";
import { htmlChildren, htmlFallback, pendingFallback } from "./html.ts";
import { analyzeJavaScriptExpression } from "./javascript-jsx.ts";
import { hasJavaScriptToken } from "./javascript.ts";
import { recordJsxReference, resolveJsxName } from "./jsx-reference.ts";

/** JavaScript scope shared by analysis and emission. Analysis records references into it. */
export interface CompileScope extends JavaScriptJsxContext {
  readonly file: SourceFile | undefined;
  readonly inScope: ReadonlySet<string>;
  readonly missingReferences: Map<string, boolean>;
  readonly referencedComponents: Set<string>;
}

export interface CompileAnalysis {
  readonly esm: EmittedEsm;
  readonly intrinsicTags: ReadonlySet<string>;
  readonly scope: CompileScope;
}

export function analyzeDocument(
  document: DocumentNode,
  content: HtmlRootNode,
  options: Readonly<{
    development?: boolean;
    sourceName?: string;
    source?: SourceFile;
    outputFormat?: CompileOutputFormat;
  }>,
): CompileAnalysis {
  const inScope = new Set<string>();
  const authoredEsm: ParsedEsm[] = [];

  for (const child of document.children) {
    if (child.kind === "esm") {
      const parsed = parseEsm(child.code, child.origin);
      collectEsmBindings(parsed.program, inScope);
      authoredEsm.push(parsed);
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
  const esm = emitEsm(
    authoredEsm,
    options.outputFormat ?? "functionBody",
    { ...scope, missingReferences: new Map(), referencedComponents: new Set() },
    scope.file,
  );

  const intrinsicTags = new Set<string>();
  analyzeContent(content, scope, intrinsicTags);

  return { esm, intrinsicTags, scope };
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
      recordJsxReference(resolveJsxName(node.name), scope);

      for (const attribute of node.attributes) {
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
    case "pending":
    case "unresolvedReference":
      for (const child of pendingFallback(node)) {
        analyzeContent(child, scope, intrinsicTags);
      }

      return;
    default:
      break;
  }

  for (const child of htmlChildren(node)) {
    analyzeContent(child, scope, intrinsicTags);
  }
}
