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

/**
 * Applies items from a transport in batches, at most once per scheduled flush.
 * Rejects with an `AbortError` when `current` turns false, such as after a reset.
 */
export async function consumeBatched<TItem>(
  items: AsyncIterable<TItem>,
  apply: (items: readonly TItem[]) => void,
  schedule: MdxPublishScheduler,
  current: () => boolean,
): Promise<void> {
  let buffer: TItem[] = [];
  let scheduled = false;

  const flush = (): void => {
    scheduled = false;

    if (buffer.length > 0 && current()) {
      const batch = buffer;
      buffer = [];
      apply(batch);
    }
  };

  for await (const item of items) {
    if (!current()) {
      throw new DOMException("The MDX stream was reset", "AbortError");
    }

    buffer.push(item);

    if (!scheduled) {
      scheduled = true;
      schedule(flush);
    }
  }

  flush();
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
