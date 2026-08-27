import type { DiagnosticReporter } from "./diagnostics.ts";
import type { HtmlDocumentNode } from "./html.ts";
import type { DocumentNode, SourceFile } from "./model.ts";
import type { SyntaxOptions } from "./syntax-options.ts";
import type { HtmlRewriteHandlers, MdxRewriteHandlers } from "./traversal.ts";

export interface DocumentTransformContext {
  readonly diagnostics: DiagnosticReporter;
  readonly document: DocumentNode;
  readonly file: SourceFile;
  readonly signal?: AbortSignal;
  readonly syntax: Readonly<SyntaxOptions>;

  rewrite(handlers: MdxRewriteHandlers): DocumentNode;
}

export interface HtmlTransformContext {
  readonly diagnostics: DiagnosticReporter;
  readonly document: HtmlDocumentNode;
  readonly file: SourceFile;
  readonly signal?: AbortSignal;
  readonly syntax: Readonly<SyntaxOptions>;

  rewrite(handlers: HtmlRewriteHandlers): HtmlDocumentNode;
}

export abstract class DocumentPlugin {
  declare private readonly documentPluginBrand: void;
  public abstract readonly name: string;
}

export abstract class DocumentTransformPlugin extends DocumentPlugin {
  public abstract transform(
    context: DocumentTransformContext,
  ): DocumentNode | Promise<DocumentNode>;
}

export abstract class HtmlPlugin {
  declare private readonly htmlPluginBrand: void;
  public abstract readonly name: string;
}

export abstract class HtmlTransformPlugin extends HtmlPlugin {
  public abstract transform(
    context: HtmlTransformContext,
  ): HtmlDocumentNode | Promise<HtmlDocumentNode>;
}
