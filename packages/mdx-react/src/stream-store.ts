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
} from "@temelj/mdx";
import type { HtmlPlugin } from "@temelj/mdx/plugins";

import { LimitError, MdxStream, ParseError, Processor } from "@temelj/mdx";

import {
  consumeBatched,
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
  #stream: MdxStream;
  #options: MdxStreamStoreOptions;
  #processor: Processor;
  #source = "";
  #view: MdxStreamView;

  public constructor(options: MdxStreamStoreOptions = {}) {
    this.#options = options;
    this.#stream = new MdxStream(options);
    this.#processor = completionProcessor(options);
    this.#source = options.source ?? "";
    this.#view = streamingView(0, this.preview());
  }

  public readonly getSnapshot = (): MdxStreamView => this.#view;

  public readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);

    return () => this.#listeners.delete(listener);
  };

  public readonly append = (text: string): MdxStreamSnapshot => {
    const snapshot = this.#stream.append(text);
    this.#source = snapshot.file.text;
    this.publishPreview(snapshot);

    return snapshot;
  };

  public readonly edit = (edit: MdxEdit): MdxStreamSnapshot => {
    const snapshot = this.#stream.edit(edit);
    this.#source = snapshot.file.text;
    this.publishPreview(snapshot);

    return snapshot;
  };

  /**
   * Successful completion is terminal. A failed completion keeps the preview editable.
   * @throws {ParseError | LimitError} Publishes a failed view before throwing.
   */
  public readonly complete = (): MdxStreamCompletion => {
    let completion: MdxStreamCompletion;

    try {
      completion = this.#stream.complete();
    } catch (error) {
      if (!(error instanceof ParseError) && !(error instanceof LimitError)) {
        throw error;
      }

      this.publish(
        Object.freeze({
          kind: "failed",
          generation: this.#view.generation,
          preview: this.preview(),
          diagnostics: error.diagnostics,
        }),
      );
      throw error;
    }

    if (this.#view.kind === "complete") {
      return completion;
    }

    const generation = this.#view.generation;

    const processed = this.#processor.processSync(completion);

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
    const next = options ?? { ...this.#options, source: "" };
    this.#options = next;
    this.#stream = new MdxStream(next);
    this.#processor = completionProcessor(next);
    this.#source = next.source ?? "";
    this.publish(streamingView(this.#view.generation + 1, this.preview()));
  };

  /**
   * Appends decoded text from a transport, batching publishes, and completes at
   * EOF. Aborting, or resetting the store, stops reading and leaves the preview
   * open; the promise then rejects with the abort reason.
   */
  public readonly consume = async (
    source: MdxTextSource,
    options: MdxConsumeOptions = {},
  ): Promise<MdxStreamCompletion> => {
    options.signal?.throwIfAborted();
    const generation = this.#view.generation;

    await consumeBatched(
      textChunks(source, options.signal),
      (chunks) => this.append(chunks.join("")),
      this.#options.schedule ?? scheduleFrame,
      () => this.#view.generation === generation,
    );

    return this.complete();
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

    if (this.#view.kind === "complete" && (source !== previous || status === "streaming")) {
      this.reset({ ...this.#options, source });
    } else if (
      source.length >= previous.length &&
      (options.appendOnly === true || source.startsWith(previous))
    ) {
      if (source.length > previous.length) {
        this.append(source.slice(previous.length));
      }
    } else {
      this.edit(sourceEdit(previous, source));
    }

    if (status === "complete" && this.#view.kind === "streaming") {
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
