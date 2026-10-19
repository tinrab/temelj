"use client";

import type { Diagnostic, MdxBlockEvent, MdxEventDiagnostic, MdxPreview } from "@temelj/mdx";

import { applyBlockEvent } from "@temelj/mdx";
import { isObject, isString } from "@temelj/value";

import type { MdxStreamView } from "./stream-store.ts";

import {
  abortableItems,
  JsonLines,
  scheduleFrame,
  textChunks,
  StreamConsumption,
  type MdxConsumeOptions,
  type MdxPublishScheduler,
  type MdxTextSource,
} from "./transport.ts";

export interface MdxBlockStoreOptions {
  /** Schedules a batched publish while consuming a transport. Defaults to the next frame. */
  readonly schedule?: MdxPublishScheduler;
}

/**
 * Block events, or the same events as newline-delimited JSON text from a
 * response, a readable stream, or an async iterable of text chunks.
 */
export type MdxBlockEventSource =
  | AsyncIterable<MdxBlockEvent | string | Uint8Array>
  | MdxTextSource;

const emptyPreview: MdxPreview = Object.freeze({ blocks: Object.freeze([]), footnotes: undefined });

/**
 * Renders a stream that a server parses. It applies block events from
 * `streamBlockEvents`, so the client never parses source.
 */
export class MdxBlockStore {
  readonly #listeners = new Set<() => void>();
  readonly #consumption = new StreamConsumption();
  readonly #options: MdxBlockStoreOptions;
  #view: MdxStreamView = streamingView(0, emptyPreview);

  public constructor(options: MdxBlockStoreOptions = {}) {
    this.#options = options;
  }

  public readonly getSnapshot = (): MdxStreamView => this.#view;

  public readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);

    return () => this.#listeners.delete(listener);
  };

  /** Applies one event. Events after completion are ignored until a reset. */
  public readonly apply = (event: MdxBlockEvent): void => {
    const view = this.#view;

    if (view.kind === "complete") {
      return;
    }

    switch (event.kind) {
      case "update":
        this.publish(
          Object.freeze({
            kind: "streaming",
            generation: view.generation,
            preview: applyBlockEvent(view.preview, event),
            diagnostics: Object.freeze([]),
            limit: event.limit,
          }),
        );
        break;
      case "complete":
        this.publish(
          Object.freeze({
            kind: "complete",
            generation: view.generation,
            html: event.html,
            blocks: event.blocks,
            diagnostics: Object.freeze([]),
          }),
        );
        break;
      case "failed":
        this.publish(
          Object.freeze({
            kind: "failed",
            generation: view.generation,
            preview: view.preview,
            diagnostics: Object.freeze(event.diagnostics.map(eventDiagnostic)),
          }),
        );
        break;
      default: {
        const exhaustive: never = event;

        return exhaustive;
      }
    }
  };

  /** Starts an empty document. */
  public readonly reset = (): void => {
    this.#consumption.reset();
    this.publish(streamingView(this.#view.generation + 1, emptyPreview));
  };

  /**
   * Applies events from a transport, batching publishes. Aborting, or resetting
   * the store, stops reading; the promise then rejects with the abort reason.
   * Rejects overlapping consumers and EOF without a complete or failed event.
   */
  public readonly consume = (
    source: MdxBlockEventSource,
    options: MdxConsumeOptions = {},
  ): Promise<MdxStreamView> => {
    let terminal = false;

    return this.#consumption.consume({
      items: (signal) => blockEvents(source, signal),
      apply: (events, signal) => {
        for (const event of events) {
          signal.throwIfAborted();
          this.apply(event);
          terminal ||= event.kind !== "update";
        }
      },
      schedule: this.#options.schedule ?? scheduleFrame,
      signal: options.signal,
      complete: () => {
        if (!terminal || this.#view.kind === "streaming") {
          throw new Error("The MDX block stream ended without a terminal event");
        }

        return this.#view;
      },
    });
  };

  private publish(view: MdxStreamView): void {
    this.#view = view;

    for (const listener of this.#listeners) {
      listener();
    }
  }
}

async function* blockEvents(
  source: MdxBlockEventSource,
  signal: AbortSignal,
): AsyncGenerator<MdxBlockEvent> {
  const lines = new JsonLines();
  const decoder = new TextDecoder();

  const items: AsyncIterable<MdxBlockEvent | string | Uint8Array> =
    source instanceof Response || "getReader" in source
      ? textChunks(source, signal)
      : abortableItems(source, signal);

  for await (const item of items) {
    signal.throwIfAborted();

    if (isString(item) || item instanceof Uint8Array) {
      yield* blockEventsOf(
        lines.push(isString(item) ? item : decoder.decode(item, { stream: true })),
      );
    } else {
      yield* blockEventsOf([item]);
    }
  }

  signal.throwIfAborted();
  yield* blockEventsOf(lines.end(decoder.decode()));
}

function* blockEventsOf(values: readonly unknown[]): Generator<MdxBlockEvent> {
  for (const value of values) {
    if (!isBlockEvent(value)) {
      throw new TypeError("Expected an MDX block event");
    }

    yield value;
  }
}

/** The wire format is trusted to come from `streamBlockEvents`; only its discriminant is checked. */
function isBlockEvent(value: unknown): value is MdxBlockEvent {
  return (
    isObject(value) &&
    "kind" in value &&
    (value.kind === "update" || value.kind === "complete" || value.kind === "failed")
  );
}

function eventDiagnostic(diagnostic: MdxEventDiagnostic): Diagnostic {
  return {
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
  };
}

function streamingView(generation: number, preview: MdxPreview): MdxStreamView {
  return Object.freeze({
    kind: "streaming",
    generation,
    preview,
    diagnostics: Object.freeze([]),
    limit: undefined,
  });
}
