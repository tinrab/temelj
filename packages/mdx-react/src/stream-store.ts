"use client";

import type {
  CompletedBlock,
  Diagnostic,
  HtmlRenderOptions,
  HtmlRootNode,
  MdxEdit,
  MdxPreview,
  MdxStreamCompletion,
  MdxStreamOptions,
  MdxStreamSnapshot,
  ParserLimit,
  ProcessResult,
  SourceFile,
} from "@temelj/mdx";
import type { HtmlPlugin } from "@temelj/mdx/plugins";

import { LimitError, MdxStream, ParseError, Processor, TransformError } from "@temelj/mdx";

import {
  StreamConsumption,
  scheduleFrame,
  sourceEdit,
  textChunks,
  type MdxConsumeOptions,
  type MdxPublishScheduler,
  type MdxTextSource,
} from "./transport.ts";

export interface MdxStreamStoreOptions extends MdxStreamOptions {
  /** Shared by the completed document's HTML lowering. */
  readonly html?: Omit<HtmlRenderOptions, "source">;
  /**
   * Synchronous HTML plugins for the completed document. They run in the store,
   * outside React render, so completed output matches `Processor` output.
   */
  readonly htmlPlugins?: readonly HtmlPlugin[];
  /** Schedules a batched publish while consuming a transport. Defaults to the next frame. */
  readonly schedule?: MdxPublishScheduler;
}

/**
 * What a renderer shows for one document. A generation identifies one document
 * lifecycle, so a reset remounts its content. Views are plain data: a stream
 * store and a block store produce the same shapes.
 */
export type MdxStreamView =
  | Readonly<{
      kind: "streaming";
      generation: number;
      preview: MdxPreview;
      diagnostics: readonly Diagnostic[];
      /** The limit the source exceeds; the preview then keeps the last valid blocks. */
      limit: ParserLimit | undefined;
    }>
  | Readonly<{
      kind: "complete";
      generation: number;
      html: HtmlRootNode;
      /** The stream blocks the document came from, so renderers keep their identities. */
      blocks: readonly CompletedBlock[];
      diagnostics: readonly Diagnostic[];
    }>
  | Readonly<{
      kind: "failed";
      generation: number;
      /** The last preview, which stays editable. */
      preview: MdxPreview;
      diagnostics: readonly Diagnostic[];
    }>;

/** Owns one stream session and publishes immutable views to React. */
export class MdxStreamStore {
  readonly #listeners = new Set<() => void>();
  readonly #consumption = new StreamConsumption();
  #stream: MdxStream;
  #options: MdxStreamStoreOptions;
  #processor: Processor;
  #source: SourceFile;
  #view: MdxStreamView;

  public constructor(options: MdxStreamStoreOptions = {}) {
    this.#options = options;
    this.#stream = new MdxStream(options);
    this.#processor = completionProcessor(options);
    const snapshot = this.preview();
    this.#source = snapshot.file;
    this.#view = streamingView(0, snapshot);
  }

  public readonly getSnapshot = (): MdxStreamView => this.#view;

  public readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);

    return () => this.#listeners.delete(listener);
  };

  public readonly append = (text: string): MdxStreamSnapshot => {
    const snapshot = this.#stream.append(text);
    this.#source = snapshot.file;
    this.publishPreview(snapshot);

    return snapshot;
  };

  public readonly edit = (edit: MdxEdit): MdxStreamSnapshot => {
    const snapshot = this.#stream.edit(edit);
    this.#source = snapshot.file;
    this.publishPreview(snapshot);

    return snapshot;
  };

  /**
   * Successful completion is terminal. A failed completion keeps the preview editable.
   * @throws {ParseError | LimitError | TransformError} Publishes a failed view before throwing.
   */
  public readonly complete = (): MdxStreamCompletion => {
    if (this.#view.kind === "complete") {
      return this.#stream.complete();
    }

    const preview = this.preview();
    const generation = this.#view.generation;
    let completion: MdxStreamCompletion;
    let processed: ProcessResult;

    try {
      completion = this.#stream.complete();
      processed = this.#processor.processSync(completion);
    } catch (error) {
      if (this.#stream.snapshot().kind === "complete") {
        this.#stream = new MdxStream({ ...this.#options, source: this.#source.text });
      }

      this.publish(
        Object.freeze({
          kind: "failed",
          generation,
          preview,
          diagnostics:
            error instanceof ParseError ||
            error instanceof LimitError ||
            error instanceof TransformError
              ? error.diagnostics
              : preview.diagnostics,
        }),
      );
      throw error;
    }

    this.publish(
      Object.freeze({
        kind: "complete",
        generation,
        html: processed.html,
        blocks: completion.blocks,
        diagnostics: processed.diagnostics,
      }),
    );

    return completion;
  };

  /** Starts an empty document, or a document with new options and initial source. */
  public readonly reset = (options?: MdxStreamStoreOptions): void => {
    this.#consumption.reset();
    const next = options ?? { ...this.#options, source: "" };
    this.#options = next;
    this.#stream = new MdxStream(next);
    this.#processor = completionProcessor(next);
    const snapshot = this.preview();
    this.#source = snapshot.file;
    this.publish(streamingView(this.#view.generation + 1, snapshot));
  };

  /**
   * Appends decoded text from a transport, batching publishes, and completes at
   * EOF. Aborting, or resetting the store, stops reading and leaves the preview
   * open; the promise then rejects with the abort reason.
   * Rejects overlapping consumers and unsuccessful HTTP responses.
   */
  public readonly consume = (
    source: MdxTextSource,
    options: MdxConsumeOptions = {},
  ): Promise<MdxStreamCompletion> => {
    return this.#consumption.consume({
      items: (signal) => textChunks(source, signal),
      apply: (chunks) => this.append(chunks.join("")),
      schedule: this.#options.schedule ?? scheduleFrame,
      signal: options.signal,
      complete: this.complete,
    });
  };

  /**
   * Moves the session to `source`, appending when it only grew. With
   * `appendOnly`, a longer source is trusted to extend the previous one, which
   * skips comparing the shared prefix.
   */
  public setSource(
    source: string,
    status: "streaming" | "complete",
    options: Readonly<{ appendOnly?: boolean }> = {},
  ): void {
    const previous = this.#source;

    if (this.#view.kind === "complete" && (status === "streaming" || source !== previous.text)) {
      this.reset({ ...this.#options, source });
    } else if (
      source.length >= previous.length &&
      (options.appendOnly === true || source.startsWith(previous.text))
    ) {
      if (source.length > previous.length) {
        this.append(source.slice(previous.length));
      }
    } else {
      this.edit(sourceEdit(previous.text, source));
    }

    if (status === "complete" && this.#view.kind !== "complete") {
      this.complete();
    }
  }

  private preview(): MdxStreamSnapshot {
    const snapshot = this.#stream.snapshot();

    if (snapshot.kind !== "preview") {
      throw new Error("A completed stream has no preview");
    }

    return snapshot;
  }

  private publishPreview(snapshot: MdxStreamSnapshot): void {
    if (this.#view.kind === "complete" || this.#view.preview !== snapshot) {
      this.publish(streamingView(this.#view.generation, snapshot));
    }
  }

  private publish(view: MdxStreamView): void {
    this.#view = view;

    for (const listener of this.#listeners) {
      listener();
    }
  }
}

function streamingView(generation: number, snapshot: MdxStreamSnapshot): MdxStreamView {
  return Object.freeze({
    kind: "streaming",
    generation,
    preview: snapshot,
    diagnostics: snapshot.diagnostics,
    limit: snapshot.limit,
  });
}

function completionProcessor(options: MdxStreamStoreOptions): Processor {
  return new Processor({
    syntax: options.syntax,
    limits: options.limits,
    html: options.html,
    htmlPlugins: options.htmlPlugins,
  });
}
