"use client";

import type { MdxEdit } from "@temelj/mdx";

import { isString } from "@temelj/value";

/** Text chunks from a response, a readable stream, or an async iterable. */
export type MdxTextSource =
  | Response
  | ReadableStream<string | Uint8Array>
  | AsyncIterable<string | Uint8Array>;

export interface MdxConsumeOptions {
  readonly signal?: AbortSignal;
}

/** Schedules a batched publish. Defaults to the next animation frame. */
export type MdxPublishScheduler = (flush: () => void) => void;

export function scheduleFrame(flush: () => void): void {
  if ("requestAnimationFrame" in globalThis) {
    requestAnimationFrame(flush);
  } else {
    queueMicrotask(flush);
  }
}

export async function* textChunks(
  source: MdxTextSource,
  signal: AbortSignal,
): AsyncGenerator<string> {
  if (source instanceof Response && !source.ok) {
    throw new Error(`Could not load the MDX stream: HTTP ${source.status}`);
  }

  const decoder = new TextDecoder();
  const body = source instanceof Response ? source.body : source;

  if (body === null) {
    return;
  }

  const items =
    "getReader" in body ? { [Symbol.asyncIterator]: () => readableIterator(body) } : body;

  for await (const value of abortableItems(items, signal)) {
    yield isString(value) ? value : decoder.decode(value, { stream: true });
  }

  signal.throwIfAborted();
  const tail = decoder.decode();

  if (tail.length > 0) {
    yield tail;
  }
}

/**
 * Stops waiting on cancellation even when the source cannot interrupt its next read.
 * @yields Items from the source until completion or cancellation.
 */
export async function* abortableItems<T>(
  source: AsyncIterable<T>,
  signal: AbortSignal,
): AsyncGenerator<T> {
  signal.throwIfAborted();

  const iterator = source[Symbol.asyncIterator]();

  try {
    while (true) {
      signal.throwIfAborted();

      const aborted = Promise.withResolvers<never>();
      const abort = (): void => aborted.reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });

      const next = Promise.resolve().then(() => {
        signal.throwIfAborted();

        return iterator.next();
      });

      const result = await Promise.race([next, aborted.promise]).finally(() =>
        signal.removeEventListener("abort", abort),
      );

      signal.throwIfAborted();

      if (result.done === true) {
        return;
      }

      yield result.value;
    }
  } finally {
    // An async generator's return may wait for its pending next indefinitely.
    void Promise.resolve()
      .then(() => iterator.return?.())
      .catch(() => {});
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

        try {
          void reader.cancel().catch(() => {});
        } finally {
          reader.releaseLock();
        }
      }

      return { done: true, value: undefined };
    },
  };
}

export function sourceEdit(previous: string, next: string): MdxEdit {
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

interface ConsumptionOptions<TItem, TResult> {
  readonly items: (signal: AbortSignal) => AsyncIterable<TItem>;
  readonly apply: (items: readonly TItem[], signal: AbortSignal) => void;
  readonly schedule: MdxPublishScheduler;
  readonly complete: () => TResult;
  readonly signal?: AbortSignal;
}

/** Owns the active reader and invalidates scheduled work when the session resets. */
export class StreamConsumption {
  #controller: AbortController | undefined;

  public reset(): void {
    const controller = this.#controller;
    this.#controller = undefined;
    controller?.abort(new DOMException("The MDX stream was reset", "AbortError"));
  }

  public async consume<TItem, TResult>(
    options: ConsumptionOptions<TItem, TResult>,
  ): Promise<TResult> {
    options.signal?.throwIfAborted();

    if (this.#controller !== undefined) {
      throw new Error("An MDX stream consumption is already active");
    }

    const controller = new AbortController();
    this.#controller = controller;

    const signal =
      options.signal === undefined
        ? controller.signal
        : AbortSignal.any([controller.signal, options.signal]);

    try {
      await consumeBatched(options, controller, signal);
      signal.throwIfAborted();

      return options.complete();
    } finally {
      if (this.#controller === controller) {
        this.#controller = undefined;
      }
    }
  }
}

async function consumeBatched<TItem, TResult>(
  options: ConsumptionOptions<TItem, TResult>,
  controller: AbortController,
  signal: AbortSignal,
): Promise<void> {
  let buffer: TItem[] = [];
  let scheduled = false;
  let active = true;

  const flush = (): void => {
    scheduled = false;

    if (active && !signal.aborted && buffer.length > 0) {
      try {
        const batch = buffer;
        buffer = [];
        options.apply(batch, signal);
      } catch (error) {
        controller.abort(error);
      }
    }
  };

  try {
    for await (const item of options.items(signal)) {
      signal.throwIfAborted();

      buffer.push(item);

      if (!scheduled) {
        scheduled = true;
        options.schedule(flush);
      }
    }

    signal.throwIfAborted();
    flush();
    signal.throwIfAborted();
  } finally {
    active = false;
    buffer = [];
  }
}

/** Splits newline-delimited JSON text into values as chunks arrive. */
export class JsonLines {
  #pending = "";

  public push(text: string): unknown[] {
    this.#pending += text;
    const values: unknown[] = [];
    let end = this.#pending.indexOf("\n");

    while (end !== -1) {
      const line = this.#pending.slice(0, end).trim();
      this.#pending = this.#pending.slice(end + 1);

      if (line.length > 0) {
        const value: unknown = JSON.parse(line);
        values.push(value);
      }

      end = this.#pending.indexOf("\n");
    }

    return values;
  }

  public end(text = ""): unknown[] {
    const values = this.push(text);
    const line = this.#pending.trim();
    this.#pending = "";

    if (line.length > 0) {
      const value: unknown = JSON.parse(line);
      values.push(value);
    }

    return values;
  }
}
