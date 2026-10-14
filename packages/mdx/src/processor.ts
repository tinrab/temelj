import { isPromise, isString } from "@temelj/value";

import type { Diagnostic } from "./diagnostics.ts";
import type { HtmlRenderOptions } from "./html-lower.ts";
import type { HtmlRootNode } from "./html.ts";
import type { DocumentNode } from "./model.ts";
import type { MdxFailure, ParseOptions, ParseOutcome } from "./parser.ts";
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

export type ProcessOutcome =
  | Readonly<{
      kind: "ok";
      file: SourceFile;
      document: DocumentNode;
      html: HtmlRootNode;
      diagnostics: readonly Diagnostic[];
    }>
  | MdxFailure;

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
    options.signal?.throwIfAborted();
    const parsed = this.parseInput(input);

    if (parsed.kind !== "ok") {
      return parsed;
    }

    const run = this.pluginRun(parsed, false, options.signal);
    const document = await runDocumentPlugins(parsed.document, this.documentPlugins, run);
    const html = await runHtmlPlugins(this.lower(document, parsed.file), this.htmlPlugins, run);

    return processed(parsed.file, document, html, run.diagnostics);
  }

  /** Processes synchronously and throws a configuration error for an asynchronous plugin. */
  public processSync(input: ProcessInput): ProcessOutcome {
    const parsed = this.parseInput(input);

    if (parsed.kind !== "ok") {
      return parsed;
    }

    const run = this.pluginRun(parsed, true);
    const document = settled(runDocumentPlugins(parsed.document, this.documentPlugins, run));
    const html = settled(runHtmlPlugins(this.lower(document, parsed.file), this.htmlPlugins, run));

    return processed(parsed.file, document, html, run.diagnostics);
  }

  /**
   * Parses and runs document plugins without lowering. Pass the result to
   * `compile` to emit JavaScript from the transformed document.
   */
  public async transform(input: ProcessInput, options: ProcessOptions = {}): Promise<ParseOutcome> {
    options.signal?.throwIfAborted();
    const parsed = this.parseInput(input);

    if (parsed.kind !== "ok") {
      return parsed;
    }

    const run = this.pluginRun(parsed, false, options.signal);
    const document = await runDocumentPlugins(parsed.document, this.documentPlugins, run);

    return transformed(parsed.file, document, run.diagnostics);
  }

  /** Transforms synchronously and throws a configuration error for an asynchronous plugin. */
  public transformSync(input: ProcessInput): ParseOutcome {
    const parsed = this.parseInput(input);

    if (parsed.kind !== "ok") {
      return parsed;
    }

    const run = this.pluginRun(parsed, true);
    const document = settled(runDocumentPlugins(parsed.document, this.documentPlugins, run));

    return transformed(parsed.file, document, run.diagnostics);
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

  private pluginRun(
    parsed: Extract<ParseOutcome, { kind: "ok" }>,
    synchronous: boolean,
    signal?: AbortSignal,
  ): PluginRun {
    return {
      diagnostics: new DiagnosticBag(parsed.diagnostics),
      file: parsed.file,
      signal,
      syntax: this.options.syntax ?? {},
      synchronous,
    };
  }
}

function settled<T>(value: T | Promise<T>): T {
  // A synchronous run rejects asynchronous plugins before returning a promise.
  if (isPromise(value)) {
    throw new TypeError("Synchronous plugin run returned a promise");
  }

  return value;
}

function transformed(
  file: SourceFile,
  document: DocumentNode,
  diagnostics: DiagnosticBag,
): Extract<ParseOutcome, { kind: "ok" }> {
  return Object.freeze({ kind: "ok", file, document, diagnostics: diagnostics.snapshot() });
}

function processed(
  file: SourceFile,
  document: DocumentNode,
  html: HtmlRootNode,
  diagnostics: DiagnosticBag,
): Extract<ProcessOutcome, { kind: "ok" }> {
  return Object.freeze({ kind: "ok", file, document, html, diagnostics: diagnostics.snapshot() });
}
