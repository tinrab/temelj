import { isPromise, isString } from "@temelj/value";

import type { HtmlRenderOptions } from "./html-lower.ts";
import type { HtmlRootNode } from "./html.ts";
import type { DocumentNode } from "./model.ts";
import type { MdxFailure, MdxOutcome } from "./outcome.ts";
import type { ParseOptions, ParseOutcome } from "./parser.ts";
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

export type ProcessOutcome = MdxOutcome<{ document: DocumentNode; html: HtmlRootNode }>;

export interface ProcessOptions {
  readonly signal?: AbortSignal;
}

/** Strict input: a source string, a `SourceFile`, or an existing parse outcome. */
export type ProcessInput = string | SourceFile | ParseOutcome;

/** Parses, transforms, and lowers MDX with one configuration. */
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

  public parse(source: string | SourceFile): ParseOutcome {
    return parse(source, this.options);
  }

  public async process(input: ProcessInput, options: ProcessOptions = {}): Promise<ProcessOutcome> {
    return this.processStages(input, false, options.signal);
  }

  /** Processes synchronously and throws a configuration error for an asynchronous plugin. */
  public processSync(input: ProcessInput): ProcessOutcome {
    return settled(this.processStages(input, true));
  }

  /**
   * Parses and runs document plugins without lowering. Pass the result to
   * `compile` to emit JavaScript from the transformed document.
   */
  public async transform(input: ProcessInput, options: ProcessOptions = {}): Promise<ParseOutcome> {
    return this.transformStage(input, false, options.signal);
  }

  /** Transforms synchronously and throws a configuration error for an asynchronous plugin. */
  public transformSync(input: ProcessInput): ParseOutcome {
    return settled(this.transformStage(input, true));
  }

  /** Lowers transformed documents and runs HTML plugins with the same diagnostics. */
  private processStages(
    input: ProcessInput,
    synchronous: boolean,
    signal?: AbortSignal,
  ): Settling<ProcessOutcome> {
    return chain(this.documentStage(input, synchronous, signal), (stage) =>
      stage.kind !== "ok"
        ? stage
        : chain(
            runHtmlPlugins(this.lower(stage.document, stage.file), this.htmlPlugins, stage.run),
            (html): ProcessOutcome =>
              Object.freeze({
                kind: "ok",
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
  ): Settling<ParseOutcome> {
    return chain(this.documentStage(input, synchronous, signal), (stage): ParseOutcome =>
      stage.kind !== "ok"
        ? stage
        : Object.freeze({
            kind: "ok",
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
  ): Settling<DocumentStage | MdxFailure> {
    signal?.throwIfAborted();
    const parsed = this.parseInput(input);

    if (parsed.kind !== "ok") {
      return parsed;
    }

    const run: PluginRun = {
      diagnostics: new DiagnosticBag(parsed.diagnostics),
      file: parsed.file,
      signal,
      syntax: this.options.syntax ?? {},
      synchronous,
    };

    return chain(
      runDocumentPlugins(parsed.document, this.documentPlugins, run),
      (document): DocumentStage => ({ kind: "ok", file: parsed.file, document, run }),
    );
  }

  private get documentPlugins(): readonly DocumentPlugin[] {
    return this.options.documentPlugins ?? [];
  }

  private get htmlPlugins(): readonly HtmlPlugin[] {
    return this.options.htmlPlugins ?? [];
  }

  private parseInput(input: ProcessInput): ParseOutcome {
    return input instanceof SourceFile || isString(input) ? this.parse(input) : input;
  }

  private lower(document: DocumentNode, file: SourceFile): HtmlRootNode {
    return lowerHtml(document, { ...this.options.html, source: file });
  }
}

interface DocumentStage {
  readonly kind: "ok";
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
