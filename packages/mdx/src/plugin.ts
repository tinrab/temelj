import type { DiagnosticReporter } from "./diagnostics.ts";
import type { HtmlRootNode } from "./html.ts";
import type { DocumentNode } from "./model.ts";
import type { SourceFile } from "./source.ts";
import type { SyntaxOptions } from "./syntax-options.ts";
import type { HtmlRewriteHandlers, MdxRewriteHandlers } from "./traversal.ts";

interface PluginContextBase {
  /** Error diagnostics added by a plugin discard that plugin's result. */
  readonly diagnostics: DiagnosticReporter;
  readonly file: SourceFile;
  readonly signal?: AbortSignal;
  readonly syntax: Readonly<SyntaxOptions>;
}

export interface DocumentPluginContext extends PluginContextBase {
  readonly document: DocumentNode;

  rewrite(handlers: MdxRewriteHandlers): DocumentNode;
}

export interface HtmlPluginContext extends PluginContextBase {
  readonly root: HtmlRootNode;

  rewrite(handlers: HtmlRewriteHandlers): HtmlRootNode;
}

/** Transforms the semantic document before HTML lowering or compilation. */
export interface DocumentPlugin {
  readonly name: string;

  transform(context: DocumentPluginContext): DocumentNode | Promise<DocumentNode>;
}

/** Transforms lowered HTML. HTML plugins do not run before compilation. */
export interface HtmlPlugin {
  readonly name: string;

  transform(context: HtmlPluginContext): HtmlRootNode | Promise<HtmlRootNode>;
}

/** Whether a plugin provider fails the pipeline or keeps the fallback with a warning. */
export type PluginFailureMode = "strict" | "tolerant";
