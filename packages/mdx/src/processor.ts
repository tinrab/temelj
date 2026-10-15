import { isPromise, isString } from "@temelj/value";

import type { HtmlRenderOptions } from "./html-lower.ts";
import type { HtmlRootNode } from "./html.ts";
import type { DocumentNode } from "./model.ts";
import type { ParseOptions, ParseResult } from "./parser.ts";
import type { PluginRun } from "./plugin-internal.ts";
import type { DocumentPlugin, HtmlPlugin } from "./plugin.ts";

import { DiagnosticBag } from "./diagnostics.ts";
import { lowerHtml } from "./html-lower.ts";
import { parse } from "./parser.ts";
import { runDocumentPlugins, runHtmlPlugins } from "./plugin-internal.ts";
import { SourceFile } from "./source.ts";

export interface ProcessorOptions extends ParseOptions {
  /** Run on the semantic document before lowering and before compilation. */
  readonly documentPlugins?: readonly DocumentPlugin[];
  /** Run on lowered HTML. They do not affect compiled output. */
  readonly htmlPlugins?: readonly HtmlPlugin[];
  readonly html?: Omit<HtmlRenderOptions, "source">;
}

export interface ProcessResult extends ParseResult {
  readonly html: HtmlRootNode;
}

export interface ProcessOptions {
  readonly signal?: AbortSignal;
}

/** Strict input: a source string, a `SourceFile`, or an existing parse result. */
export type ProcessInput = string | SourceFile | ParseResult;

/**
 * Parses, transforms, and lowers MDX with one configuration.
 * Operations throw ParseError, LimitError, or TransformError on failure.
 */
export class Processor {
  public readonly options: ProcessorOptions;

  public constructor(options: ProcessorOptions = {}) {
    // Later changes to the caller's plugin arrays do not reconfigure the processor.
    this.options = {
      ...options,
      documentPlugins: [...(options.documentPlugins ?? [])],
      htmlPlugins: [...(options.htmlPlugins ?? [])],
    };
  }

  /** @throws {ParseError | LimitError | ConfigurationError} Parsing fails. */
  public parse(source: string | SourceFile): ParseResult {
    return parse(source, this.options);
  }

  /** @throws {MdxError} Parsing, transformation, or configuration fails. */
  public async process(input: ProcessInput, options: ProcessOptions = {}): Promise<ProcessResult> {
    return this.processStages(input, false, options.signal);
  }

  /**
   * Processes synchronously.
   * @throws {MdxError} Parsing, transformation, or configuration fails.
   * @throws {ConfigurationError} A plugin returns a promise.
   */
  public processSync(input: ProcessInput): ProcessResult {
    return settled(this.processStages(input, true));
  }

  /**
   * Parses and runs document plugins without lowering. Pass the result to
   * `compile` to emit JavaScript from the transformed document.
   * @throws {MdxError} Parsing, transformation, or configuration fails.
   */
  public async transform(input: ProcessInput, options: ProcessOptions = {}): Promise<ParseResult> {
    return this.transformStage(input, false, options.signal);
  }

  /**
   * Transforms synchronously.
   * @throws {MdxError} Parsing, transformation, or configuration fails.
   * @throws {ConfigurationError} A plugin returns a promise.
   */
  public transformSync(input: ProcessInput): ParseResult {
    return settled(this.transformStage(input, true));
  }

  /** Lowers transformed documents and runs HTML plugins with the same diagnostics. */
  private processStages(
    input: ProcessInput,
    synchronous: boolean,
    signal?: AbortSignal,
  ): Settling<ProcessResult> {
    return chain(this.documentStage(input, synchronous, signal), (stage) =>
      chain(
        runHtmlPlugins(
          lowerHtml(stage.document, { ...this.options.html, source: stage.file }),
          this.htmlPlugins,
          stage.run,
        ),
        (html): ProcessResult =>
          Object.freeze({
            file: stage.file,
            document: stage.document,
            html,
            diagnostics: stage.run.diagnostics.snapshot(),
          }),
      ),
    );
  }

  private transformStage(
    input: ProcessInput,
    synchronous: boolean,
    signal?: AbortSignal,
  ): Settling<ParseResult> {
    return chain(this.documentStage(input, synchronous, signal), (stage): ParseResult =>
      Object.freeze({
        file: stage.file,
        document: stage.document,
        diagnostics: stage.run.diagnostics.snapshot(),
      }),
    );
  }

  /** Parses and runs document plugins: the stage shared by transforming and processing. */
  private documentStage(
    input: ProcessInput,
    synchronous: boolean,
    signal?: AbortSignal,
  ): Settling<DocumentStage> {
    signal?.throwIfAborted();
    const parsed = input instanceof SourceFile || isString(input) ? this.parse(input) : input;

    const run: PluginRun = {
      diagnostics: new DiagnosticBag(parsed.diagnostics),
      file: parsed.file,
      signal,
      syntax: this.options.syntax ?? {},
      synchronous,
    };

    return chain(
      runDocumentPlugins(parsed.document, this.documentPlugins, run),
      (document): DocumentStage => ({ file: parsed.file, document, run }),
    );
  }

  private get documentPlugins(): readonly DocumentPlugin[] {
    return this.options.documentPlugins ?? [];
  }

  private get htmlPlugins(): readonly HtmlPlugin[] {
    return this.options.htmlPlugins ?? [];
  }
}

interface DocumentStage {
  readonly file: SourceFile;
  readonly document: DocumentNode;
  readonly run: PluginRun;
}

/** A value now, or later when an asynchronous plugin is involved. */
type Settling<TValue> = TValue | Promise<TValue>;

function chain<TValue, TResult>(
  value: Settling<TValue>,
  step: (value: TValue) => Settling<TResult>,
): Settling<TResult> {
  return isPromise(value) ? value.then(step) : step(value);
}

function settled<T>(value: Settling<T>): T {
  // A synchronous run rejects asynchronous plugins before returning a promise.
  if (isPromise(value)) {
    throw new TypeError("Synchronous plugin run returned a promise");
  }

  return value;
}
