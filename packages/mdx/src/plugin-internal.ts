import { isPromise } from "@temelj/value";

import type { DiagnosticBag } from "./diagnostics.ts";
import type { HtmlNode, HtmlRootNode } from "./html.ts";
import type { DocumentNode } from "./model.ts";
import type {
  DocumentPlugin,
  DocumentPluginContext,
  HtmlPlugin,
  HtmlPluginContext,
} from "./plugin.ts";
import type { SourceFile } from "./source.ts";
import type { SyntaxOptions } from "./syntax-options.ts";

import { ConfigurationError, TransformError } from "./errors.ts";
import { rewriteHtml, rewriteMdx, walkHtml } from "./traversal.ts";

export interface PluginRun {
  readonly diagnostics: DiagnosticBag;
  readonly file: SourceFile;
  readonly signal?: AbortSignal;
  readonly syntax: Readonly<SyntaxOptions>;
  /** Rejects asynchronous plugin results. */
  readonly synchronous: boolean;
}

export function runDocumentPlugins(
  document: DocumentNode,
  plugins: readonly DocumentPlugin[],
  run: PluginRun,
): DocumentNode | Promise<DocumentNode> {
  return runPlugins("document", document, plugins, run, (current): DocumentPluginContext => ({
    diagnostics: run.diagnostics,
    document: current,
    file: run.file,
    signal: run.signal,
    syntax: run.syntax,
    rewrite: (handlers) => rewriteMdx(current, handlers),
  }));
}

export function runHtmlPlugins(
  root: HtmlRootNode,
  plugins: readonly HtmlPlugin[],
  run: PluginRun,
): HtmlRootNode | Promise<HtmlRootNode> {
  return runPlugins("html", root, plugins, run, (current): HtmlPluginContext => ({
    diagnostics: run.diagnostics,
    root: current,
    file: run.file,
    signal: run.signal,
    syntax: run.syntax,
    rewrite: (handlers) => rewriteHtml(current, handlers),
  }));
}

interface Plugin<TTree, TContext> {
  readonly name: string;

  transform(context: TContext): TTree | Promise<TTree>;
}

/**
 * Runs plugins in order. Synchronous results continue in the same call; the
 * first asynchronous result continues the remaining plugins after it settles.
 */
function runPlugins<TTree, TContext>(
  stage: "document" | "html",
  tree: TTree,
  plugins: readonly Plugin<TTree, TContext>[],
  run: PluginRun,
  context: (tree: TTree) => TContext,
): TTree | Promise<TTree> {
  let current = tree;

  for (let index = 0; index < plugins.length; index++) {
    run.signal?.throwIfAborted();
    const plugin = plugins[index];
    const diagnosticStart = run.diagnostics.size;
    const previous = current;

    const accept = (result: TTree): TTree =>
      run.diagnostics.hasErrorsSince(diagnosticStart) ? previous : result;

    const fail = (cause: unknown): never => {
      run.signal?.throwIfAborted();

      if (cause instanceof ConfigurationError) {
        throw cause;
      }

      TransformError.pluginTransformFailed(stage, plugin.name, cause);
    };

    const result = transformWith(plugin, context(current), fail);

    if (isPromise(result)) {
      if (run.synchronous) {
        ConfigurationError.asynchronousPluginInSynchronousProcessor();
      }

      const remaining = plugins.slice(index + 1);

      return result
        .then(accept, fail)
        .then((next) => runPlugins(stage, next, remaining, run, context));
    }

    current = accept(result);
  }

  return current;
}

function transformWith<TTree, TContext>(
  plugin: Plugin<TTree, TContext>,
  context: TContext,
  fail: (cause: unknown) => never,
): TTree | Promise<TTree> {
  try {
    return plugin.transform(context);
  } catch (cause) {
    return fail(cause);
  }
}

export type HtmlNodeReplacement = HtmlNode | null | undefined;

/**
 * Replaces HTML nodes with possibly asynchronous results. `undefined` keeps a
 * node and `null` removes it. Replaced nodes are not visited again.
 */
export function replaceHtmlNodes(
  root: HtmlRootNode,
  replace: (node: HtmlNode) => HtmlNodeReplacement | Promise<HtmlNodeReplacement>,
): HtmlRootNode | Promise<HtmlRootNode> {
  const pending: Array<Promise<readonly [HtmlNode, HtmlNodeReplacement]>> = [];
  const replacements = new Map<HtmlNode, HtmlNodeReplacement>();

  for (const { node } of walkHtml(root)) {
    const result = replace(node);

    if (isPromise(result)) {
      pending.push(result.then((value) => [node, value] as const));
    } else if (result !== undefined) {
      replacements.set(node, result);
    }
  }

  const lookup = ({ node }: { readonly node: HtmlNode }): HtmlNodeReplacement =>
    replacements.get(node);

  const apply = (): HtmlRootNode =>
    rewriteHtml(root, {
      codeBlock: lookup,
      comment: lookup,
      doctype: lookup,
      element: lookup,
      expression: lookup,
      footnoteReference: lookup,
      footnoteSection: lookup,
      jsx: lookup,
      math: lookup,
      raw: lookup,
      root: lookup,
      text: lookup,
    });

  if (pending.length === 0) {
    return apply();
  }

  return Promise.all(pending).then((entries) => {
    for (const [node, value] of entries) {
      if (value !== undefined) {
        replacements.set(node, value);
      }
    }

    return apply();
  });
}
