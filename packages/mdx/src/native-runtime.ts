import { isPromise } from "@temelj/value";

import type { PluginPipelineOptions, PluginPipelineResult } from "./plugin-internal.ts";

import { ConfigurationError, TransformError } from "./errors.ts";
import { HtmlDocumentNode, renderHtml } from "./html.ts";
import { DocumentNode } from "./model.ts";
import { documentTransformContext, htmlTransformContext } from "./plugin-internal.ts";

export async function runNativePipeline(
  options: PluginPipelineOptions,
): Promise<PluginPipelineResult> {
  let document = options.document;
  for (const plugin of options.documentPlugins) {
    options.signal?.throwIfAborted();
    const original = document;
    const diagnosticStart = options.diagnostics.size;
    try {
      const result = await plugin.transform(
        documentTransformContext(
          document,
          options.file,
          options.syntax,
          options.diagnostics,
          options.signal,
        ),
      );
      if (!(result instanceof DocumentNode)) {
        throw new TypeError("Document plugin returned a value that is not a DocumentNode");
      }
      document = options.diagnostics.hasErrorsSince(diagnosticStart) ? original : result;
    } catch (cause) {
      options.signal?.throwIfAborted();
      if (cause instanceof ConfigurationError) {
        throw cause;
      }
      TransformError.pluginDocumentTransformFailed(plugin.name, cause, document.origin);
    }
  }

  let html = renderHtml(document, options.htmlOptions);
  for (const plugin of options.htmlPlugins) {
    options.signal?.throwIfAborted();
    const original = html;
    const diagnosticStart = options.diagnostics.size;
    try {
      const result = await plugin.transform(
        htmlTransformContext(
          html,
          options.file,
          options.syntax,
          options.diagnostics,
          options.signal,
        ),
      );
      if (!(result instanceof HtmlDocumentNode)) {
        throw new TypeError("HTML plugin returned a value that is not an HtmlDocumentNode");
      }
      html = options.diagnostics.hasErrorsSince(diagnosticStart) ? original : result;
    } catch (cause) {
      options.signal?.throwIfAborted();
      if (cause instanceof ConfigurationError) {
        throw cause;
      }
      TransformError.pluginHtmlTransformFailed(plugin.name, cause, html.origin);
    }
  }
  return { document, html };
}

export function runNativePipelineSync(options: PluginPipelineOptions): PluginPipelineResult {
  let document = options.document;
  for (const plugin of options.documentPlugins) {
    const original = document;
    const diagnosticStart = options.diagnostics.size;
    try {
      const result = plugin.transform(
        documentTransformContext(document, options.file, options.syntax, options.diagnostics),
      );
      if (isPromise(result)) {
        ConfigurationError.asynchronousPluginInSynchronousProcessor();
      }
      if (!(result instanceof DocumentNode)) {
        throw new TypeError("Document plugin returned a value that is not a DocumentNode");
      }
      document = options.diagnostics.hasErrorsSince(diagnosticStart) ? original : result;
    } catch (cause) {
      if (cause instanceof ConfigurationError) {
        throw cause;
      }
      TransformError.pluginDocumentTransformFailed(plugin.name, cause, document.origin);
    }
  }

  let html = renderHtml(document, options.htmlOptions);
  for (const plugin of options.htmlPlugins) {
    const original = html;
    const diagnosticStart = options.diagnostics.size;
    try {
      const result = plugin.transform(
        htmlTransformContext(html, options.file, options.syntax, options.diagnostics),
      );
      if (isPromise(result)) {
        ConfigurationError.asynchronousPluginInSynchronousProcessor();
      }
      if (!(result instanceof HtmlDocumentNode)) {
        throw new TypeError("HTML plugin returned a value that is not an HtmlDocumentNode");
      }
      html = options.diagnostics.hasErrorsSince(diagnosticStart) ? original : result;
    } catch (cause) {
      if (cause instanceof ConfigurationError) {
        throw cause;
      }
      TransformError.pluginHtmlTransformFailed(plugin.name, cause, html.origin);
    }
  }
  return { document, html };
}
