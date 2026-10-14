"use client";

import type {
  Diagnostic,
  HtmlRenderOptions,
  HtmlRootNode,
  MdxEdit,
  MdxStreamCompletion,
  MdxStreamOptions,
  MdxStreamSnapshot,
} from "@temelj/mdx";
import type { HtmlPlugin } from "@temelj/mdx/plugins";

import { MdxStream, Processor } from "@temelj/mdx";
import { isString } from "@temelj/value";

export interface MdxStreamStoreOptions extends MdxStreamOptions {
  /** Shared by the completed document's HTML lowering. */
  readonly html?: Omit<HtmlRenderOptions, "source">;
  /**
   * Synchronous HTML plugins for the completed document. They run in the store,
   * outside React render, so completed output matches `Processor` output.
   */
  readonly htmlPlugins?: readonly HtmlPlugin[];
  /** Schedules a batched publish while consuming a transport. Defaults to the next frame. */
  readonly schedule?: (flush: () => void) => void;
}

type SuccessfulCompletion = Extract<MdxStreamCompletion, { kind: "ok" }>;

type FailedCompletion = Exclude<MdxStreamCompletion, { kind: "ok" }>;

/** A generation identifies one document lifecycle within a renderer. */
export type MdxStreamView =
  | Readonly<{ kind: "streaming"; generation: number; snapshot: MdxStreamSnapshot }>
  | Readonly<{
      kind: "complete";
      generation: number;
      completion: SuccessfulCompletion;
      html: HtmlRootNode;
      diagnostics: readonly Diagnostic[];
    }>
  | Readonly<{
      kind: "failed";
      generation: number;
      /** The last preview, which stays editable. */
      snapshot: MdxStreamSnapshot;
      completion: FailedCompletion;
    }>;

/** Text chunks from a response, a readable stream, or an async iterable. */
export type MdxTextSource =
  | Response
  | ReadableStream<string | Uint8Array>
  | AsyncIterable<string | Uint8Array>;

export interface MdxConsumeOptions {
  readonly signal?: AbortSignal;
}

/** Owns one stream session and publishes immutable views to React. */
export class MdxStreamStore {
  readonly #listeners = new Set<() => void>();
  #stream: MdxStream;
  #options: MdxStreamStoreOptions;
  #processor: Processor;
  #view: MdxStreamView;

  public constructor(options: MdxStreamStoreOptions = {}) {
    this.#options = options;
    this.#stream = new MdxStream(options);
    this.#processor = completionProcessor(options);
    this.#view = this.view(0, this.#stream.snapshot());
  }

  public readonly getSnapshot = (): MdxStreamView => this.#view;

  public readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);

    return () => this.#listeners.delete(listener);
  };

  public readonly append = (text: string): MdxStreamSnapshot => {
    const snapshot = this.#stream.append(text);
    this.publishSnapshot(snapshot);

    return snapshot;
  };

  public readonly edit = (edit: MdxEdit): MdxStreamSnapshot => {
    const snapshot = this.#stream.edit(edit);
    this.publishSnapshot(snapshot);

    return snapshot;
  };

  /** Successful completion is terminal. A failed completion keeps the preview editable. */
  public readonly complete = (): MdxStreamCompletion => {
    const completion = this.#stream.complete();

    if (this.#view.kind === "complete" && this.#view.completion === completion) {
      return completion;
    }

    this.publish(this.view(this.#view.generation, completion));

    return completion;
  };

  /** Starts an empty document, or a document with new options and initial source. */
  public readonly reset = (options?: MdxStreamStoreOptions): void => {
    const next = options ?? { ...this.#options, source: "" };
    this.#options = next;
    this.#stream = new MdxStream(next);
    this.#processor = completionProcessor(next);
    this.publish(this.view(this.#view.generation + 1, this.#stream.snapshot()));
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
    const { signal } = options;
    signal?.throwIfAborted();
    const generation = this.#view.generation;
    const schedule = this.#options.schedule ?? scheduleFrame;
    let buffer = "";
    let scheduled = false;

    const flush = (): void => {
      scheduled = false;

      if (buffer.length > 0 && this.#view.generation === generation) {
        const text = buffer;
        buffer = "";
        this.append(text);
      }
    };

    for await (const chunk of textChunks(source, signal)) {
      if (this.#view.generation !== generation) {
        throw new DOMException("The MDX stream was reset", "AbortError");
      }

      buffer += chunk;

      if (!scheduled) {
        scheduled = true;
        schedule(flush);
      }
    }

    flush();

    return this.complete();
  };

  /** Moves the session to `source`, appending when it only grew. */
  public setSource(source: string, status: "streaming" | "complete"): void {
    const previous = this.#stream.snapshot().file.text;

    if (this.#view.kind === "complete" && (source !== previous || status === "streaming")) {
      this.reset({ ...this.#options, source });
    } else if (source.startsWith(previous)) {
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

  private publishSnapshot(snapshot: MdxStreamSnapshot): void {
    if (this.#view.kind !== "streaming" || this.#view.snapshot !== snapshot) {
      this.publish(this.view(this.#view.generation, snapshot));
    }
  }

  private view(generation: number, value: MdxStreamSnapshot | MdxStreamCompletion): MdxStreamView {
    if (value.kind === "preview") {
      return Object.freeze({ kind: "streaming", generation, snapshot: value });
    }

    if (value.kind !== "ok") {
      const snapshot = this.#stream.snapshot();

      return Object.freeze({
        kind: "failed",
        generation,
        snapshot: snapshot.kind === "preview" ? snapshot : this.previousSnapshot(),
        completion: value,
      });
    }

    const processed = this.#processor.processSync(value);

    if (processed.kind !== "ok") {
      throw new Error("A successful stream completion failed to process");
    }

    return Object.freeze({
      kind: "complete",
      generation,
      completion: value,
      html: processed.html,
      diagnostics: processed.diagnostics,
    });
  }

  private previousSnapshot(): MdxStreamSnapshot {
    if (this.#view.kind === "complete") {
      throw new Error("A completed stream has no preview");
    }

    return this.#view.snapshot;
  }

  private publish(view: MdxStreamView): void {
    this.#view = view;

    for (const listener of this.#listeners) {
      listener();
    }
  }
}

function completionProcessor(options: MdxStreamStoreOptions): Processor {
  return new Processor({
    syntax: options.syntax,
    limits: options.limits,
    html: options.html,
    htmlPlugins: options.htmlPlugins,
  });
}

function scheduleFrame(flush: () => void): void {
  if ("requestAnimationFrame" in globalThis) {
    requestAnimationFrame(flush);
  } else {
    queueMicrotask(flush);
  }
}

async function* textChunks(
  source: MdxTextSource,
  signal: AbortSignal | undefined,
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  const body = source instanceof Response ? source.body : source;

  if (body === null) {
    return;
  }

  const iterator = "getReader" in body ? readableIterator(body) : body[Symbol.asyncIterator]();
  const abort = (): void => void iterator.return?.();
  signal?.addEventListener("abort", abort, { once: true });

  try {
    for (let result = await iterator.next(); !result.done; result = await iterator.next()) {
      signal?.throwIfAborted();
      const value = result.value;
      yield isString(value) ? value : decoder.decode(value, { stream: true });
    }

    signal?.throwIfAborted();
    const tail = decoder.decode();

    if (tail.length > 0) {
      yield tail;
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    await iterator.return?.();
  }
}

function readableIterator(
  stream: ReadableStream<string | Uint8Array>,
): AsyncIterator<string | Uint8Array> {
  const reader = stream.getReader();
  let released = false;

  return {
    next: async () => {
      const result = await reader.read();

      return result.done ? { done: true, value: undefined } : result;
    },
    return: async () => {
      if (!released) {
        released = true;
        await reader.cancel();
        reader.releaseLock();
      }

      return { done: true, value: undefined };
    },
  };
}

function sourceEdit(previous: string, next: string): MdxEdit {
  let start = 0;
  const length = Math.min(previous.length, next.length);

  while (start < length && previous[start] === next[start]) {
    start++;
  }

  let previousEnd = previous.length;
  let nextEnd = next.length;

  while (
    previousEnd > start &&
    nextEnd > start &&
    previous[previousEnd - 1] === next[nextEnd - 1]
  ) {
    previousEnd--;
    nextEnd--;
  }

  return { start, end: previousEnd, text: next.slice(start, nextEnd) };
}
