import { isString } from "@temelj/value";

import type { Diagnostic } from "./diagnostics.ts";
import type { HtmlDocumentNode, HtmlRenderOptions } from "./html.ts";
import type { ParseOutcome, ParserLimits } from "./parser.ts";
import type { PluginPipelineOptions } from "./plugin-internal.ts";
import type {
  DocumentPlugin,
  DocumentTransformPlugin,
  HtmlPlugin,
  HtmlTransformPlugin,
} from "./plugin.ts";
import type { SyntaxOptions } from "./syntax-options.ts";

import { DiagnosticBag } from "./diagnostics.ts";
import { DocumentNode } from "./model.ts";
import { runNativePipeline, runNativePipelineSync } from "./native-runtime.ts";
import { parse } from "./parser.ts";
import { normalizeDocumentPlugins, normalizeHtmlPlugins } from "./plugin-internal.ts";
import { SourceFile } from "./source.ts";

export interface ProcessedDocument {
  readonly document: DocumentNode;
  readonly html: HtmlDocumentNode;
}

export type ProcessOutcome =
  | Readonly<{
      kind: "processed";
      file: SourceFile;
      value: ProcessedDocument;
      diagnostics: readonly Diagnostic[];
    }>
  | Extract<ParseOutcome, { kind: "invalid" | "limitExceeded" }>;

export interface ProcessorOptions {
  readonly documentPlugins?: readonly DocumentPlugin[];
  readonly html?: HtmlRenderOptions;
  readonly htmlPlugins?: readonly HtmlPlugin[];
  readonly parserLimits?: ParserLimits;
  readonly syntax?: SyntaxOptions;
}

export interface ProcessOptions {
  readonly signal?: AbortSignal;
}

type ProcessInput = string | SourceFile | ParseOutcome;

export class Processor {
  public readonly syntax: Readonly<SyntaxOptions>;
  private readonly htmlOptions: HtmlRenderOptions;
  private readonly parserLimits: ParserLimits;
  private readonly documentPlugins: readonly DocumentTransformPlugin[];
  private readonly htmlPlugins: readonly HtmlTransformPlugin[];

  public constructor(options: ProcessorOptions = {}) {
    this.syntax = Object.freeze({ ...options.syntax });
    this.parserLimits = { ...options.parserLimits };
    this.documentPlugins = normalizeDocumentPlugins(options.documentPlugins ?? []);
    this.htmlPlugins = normalizeHtmlPlugins(options.htmlPlugins ?? []);
    this.htmlOptions = { ...options.html };
  }

  public parse(source: string | SourceFile): ParseOutcome {
    return parse(source, { syntax: this.syntax, limits: this.parserLimits });
  }

  public async process(input: ProcessInput, options: ProcessOptions = {}): Promise<ProcessOutcome> {
    options.signal?.throwIfAborted();

    const outcome = input instanceof SourceFile || isString(input) ? this.parse(input) : input;

    if (outcome.kind !== "parsed") {
      return outcome;
    }

    const diagnostics = new DiagnosticBag(outcome.diagnostics);

    const result = await runNativePipeline(
      this.pipelineOptions(outcome.document, outcome.file, diagnostics, options.signal),
    );

    return processedOutcome(result.document, result.html, outcome.file, diagnostics);
  }

  public processSync(input: ProcessInput): ProcessOutcome {
    const outcome = input instanceof SourceFile || isString(input) ? this.parse(input) : input;

    if (outcome.kind !== "parsed") {
      return outcome;
    }

    const diagnostics = new DiagnosticBag(outcome.diagnostics);

    const result = runNativePipelineSync(
      this.pipelineOptions(outcome.document, outcome.file, diagnostics),
    );

    return processedOutcome(result.document, result.html, outcome.file, diagnostics);
  }

  private pipelineOptions(
    document: DocumentNode,
    file: SourceFile,
    diagnostics: DiagnosticBag,
    signal?: AbortSignal,
  ): PluginPipelineOptions {
    return {
      document,
      documentPlugins: this.documentPlugins,
      diagnostics,
      file,
      htmlOptions: this.htmlOptions,
      htmlPlugins: this.htmlPlugins,
      signal,
      syntax: this.syntax,
    };
  }
}

function processedOutcome(
  document: DocumentNode,
  html: HtmlDocumentNode,
  file: SourceFile,
  diagnostics: DiagnosticBag,
): Extract<ProcessOutcome, { kind: "processed" }> {
  return Object.freeze({
    kind: "processed",
    file,
    value: Object.freeze({ document, html }),
    diagnostics: diagnostics.snapshot(),
  });
}
