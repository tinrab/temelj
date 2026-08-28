import { isPromise } from "@temelj/value";

import type { DiagnosticBag, DiagnosticReporter } from "./diagnostics.ts";
import type { DocumentNode, SourceFile } from "./model.ts";
import type { DocumentTransformContext, HtmlTransformContext } from "./plugin.ts";
import type { SyntaxOptions } from "./syntax-options.ts";
import type { HtmlRewriteHandlers, MdxRewriteHandlers } from "./traversal.ts";

import { ConfigurationError } from "./errors.ts";
import { HtmlDocumentNode, HtmlElementNode, type HtmlRenderOptions } from "./html.ts";
import {
  DocumentPlugin,
  DocumentTransformPlugin,
  HtmlPlugin,
  HtmlTransformPlugin,
} from "./plugin.ts";
import { rewriteHtml, rewriteMdx, walkHtml } from "./traversal.ts";

export function normalizeDocumentPlugins(
  plugins: readonly DocumentPlugin[],
): readonly DocumentTransformPlugin[] {
  const normalized: DocumentTransformPlugin[] = [];
  for (const [index, plugin] of plugins.entries()) {
    const fallbackName = `document plugin at index ${index}`;
    if (!(plugin instanceof DocumentPlugin)) {
      ConfigurationError.invalidPluginInstance("document", fallbackName);
    }
    const name = validPluginName(plugin.name, fallbackName);
    if (!(plugin instanceof DocumentTransformPlugin)) {
      ConfigurationError.invalidPluginInstance("document", name);
    }
    normalized.push(plugin);
  }
  return normalized;
}

export function normalizeHtmlPlugins(
  plugins: readonly HtmlPlugin[],
): readonly HtmlTransformPlugin[] {
  const normalized: HtmlTransformPlugin[] = [];
  for (const [index, plugin] of plugins.entries()) {
    const fallbackName = `HTML plugin at index ${index}`;
    if (!(plugin instanceof HtmlPlugin)) {
      ConfigurationError.invalidPluginInstance("html", fallbackName);
    }
    const name = validPluginName(plugin.name, fallbackName);
    if (!(plugin instanceof HtmlTransformPlugin)) {
      ConfigurationError.invalidPluginInstance("html", name);
    }
    normalized.push(plugin);
  }
  return normalized;
}

function validPluginName(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export interface PluginPipelineOptions {
  readonly diagnostics: DiagnosticBag;
  readonly document: DocumentNode;
  readonly file: SourceFile;
  readonly htmlOptions: HtmlRenderOptions;
  readonly signal?: AbortSignal;
  readonly syntax: Readonly<SyntaxOptions>;
  readonly documentPlugins: readonly DocumentTransformPlugin[];
  readonly htmlPlugins: readonly HtmlTransformPlugin[];
}

export interface PluginPipelineResult {
  readonly document: DocumentNode;
  readonly html: HtmlDocumentNode;
}

export function documentTransformContext(
  document: DocumentNode,
  file: SourceFile,
  syntax: Readonly<SyntaxOptions>,
  diagnostics: DiagnosticReporter,
  signal?: AbortSignal,
): DocumentTransformContext {
  return {
    document,
    file,
    syntax,
    diagnostics,
    signal,
    rewrite: (handlers: MdxRewriteHandlers) => rewriteMdx(document, handlers),
  };
}

export function htmlTransformContext(
  document: HtmlDocumentNode,
  file: SourceFile,
  syntax: Readonly<SyntaxOptions>,
  diagnostics: DiagnosticReporter,
  signal?: AbortSignal,
): HtmlTransformContext {
  return {
    document,
    file,
    syntax,
    diagnostics,
    signal,
    rewrite: (handlers: HtmlRewriteHandlers) => rewriteHtml(document, handlers),
  };
}

export function rewriteHtmlElements(
  document: HtmlDocumentNode,
  transform: (
    element: HtmlElementNode,
  ) => HtmlElementNode | Promise<HtmlElementNode | undefined> | undefined,
): HtmlDocumentNode | Promise<HtmlDocumentNode> {
  const changes: Array<{
    node: HtmlElementNode;
    result: HtmlElementNode | Promise<HtmlElementNode | undefined> | undefined;
  }> = [];
  let asynchronous = false;
  for (const { node } of walkHtml(document)) {
    if (!(node instanceof HtmlElementNode)) {
      continue;
    }
    const result = transform(node);
    asynchronous ||= isPromise(result);
    changes.push({ node, result });
  }
  if (asynchronous) {
    return Promise.all(changes.map(async ({ node, result }) => [node, await result] as const)).then(
      (replacements) => applyElementReplacements(document, replacements),
    );
  }
  const replacements: Array<readonly [HtmlElementNode, HtmlElementNode | undefined]> = [];
  for (const { node, result } of changes) {
    if (!isPromise(result)) {
      replacements.push([node, result]);
    }
  }
  return applyElementReplacements(document, replacements);
}

function applyElementReplacements(
  document: HtmlDocumentNode,
  entries: readonly (readonly [HtmlElementNode, HtmlElementNode | undefined])[],
): HtmlDocumentNode {
  const replacements = new Map(entries);
  return rewriteHtml(document, {
    element: ({ node }) => replacements.get(node),
  });
}
