import type { AudioContextLike } from "../context/context.ts";
import type { AudioSourceInput, AudioSourceSelectionOptions } from "./loading.ts";

import { AudioDisposedError, AudioGraphError } from "../errors.ts";
import { isAudioBufferValue } from "../guards.ts";
import { loadAudio, getAudioFormat } from "./loading.ts";

const SUPPORTED_AUDIO_BUFFER_SOURCE_TYPES: ReadonlySet<string> = new Set([
  "aac",
  "aif",
  "aifc",
  "aiff",
  "flac",
  "m4a",
  "m4b",
  "m4p",
  "m4r",
  "mp3",
  "mp4",
  "mpeg",
  "oga",
  "ogg",
  "opus",
  "wav",
  "wave",
  "webm",
  "x-aiff",
  "x-flac",
  "x-m4a",
  "x-wav",
] as const);

export type BufferCollectionOptions = AudioSourceSelectionOptions;

/**
 * Returns whether `buffer` holds audio, that is, whether it has at least one frame.
 */
export function isAudioBufferLoaded(buffer: AudioBuffer): boolean {
  return buffer.length > 0;
}

/**
 * Returns whether `source` names an audio format the package can decode. `source` may be a MIME
 * type (`audio/ogg`) or a format name (`mp3`); file names and URLs are checked by extension. The
 * check uses a fixed list of formats and does not call `canPlayType()`.
 */
export function isAudioBufferSourceTypeSupported(source: string | URL): boolean {
  const value = String(source).trim().toLowerCase();
  const mimeSubtype = /^audio\/([^;,]+)$/.exec(value)?.[1];
  const type = mimeSubtype ?? getAudioFormat(value) ?? value;

  return SUPPORTED_AUDIO_BUFFER_SOURCE_TYPES.has(type);
}

/**
 * Returns `source` when it is already a buffer, otherwise loads and decodes it.
 */
export async function resolveAudioBuffer(
  context: AudioContextLike,
  source: AudioSourceInput,
  options: AudioSourceSelectionOptions = {},
): Promise<AudioBuffer> {
  return isAudioBufferValue(source) ? source : loadAudio(context, source, options);
}

/**
 * Named buffers, set directly with `set()` or loaded from any audio source with `add()`.
 */
export class BufferCollection<TName extends string = string> {
  readonly #context: AudioContextLike;
  readonly #options: BufferCollectionOptions;
  readonly #buffers = new Map<TName, AudioBuffer>();
  readonly #pending = new Set<Promise<unknown>>();
  #disposed = false;

  constructor(context: AudioContextLike, options: BufferCollectionOptions = {}) {
    this.#context = context;
    this.#options = options;
  }

  /**
   * Creates a collection and loads every source.
   */
  static async load<TName extends string>(
    context: AudioContextLike,
    sources: Readonly<Record<TName, AudioSourceInput>>,
    options: BufferCollectionOptions = {},
  ): Promise<BufferCollection<TName>> {
    const collection = new BufferCollection<TName>(context, options);
    await Promise.all(
      // SAFETY: `Object.entries` widens the keys of a `Record<TName, …>` to string.
      (Object.entries(sources) as [TName, AudioSourceInput][]).map(([name, source]) =>
        collection.add(name, source),
      ),
    );

    return collection;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Whether no load is in flight.
   */
  get loaded(): boolean {
    return this.#pending.size === 0;
  }

  get names(): readonly TName[] {
    return [...this.#buffers.keys()];
  }

  get size(): number {
    return this.#buffers.size;
  }

  /**
   * Resolves once every load started so far has settled.
   */
  async ready(): Promise<void> {
    await Promise.allSettled(this.#pending);
  }

  async add(name: TName, source: AudioSourceInput): Promise<AudioBuffer> {
    this.#assertUsable();
    const loading = resolveAudioBuffer(this.#context, source, this.#options);
    this.#pending.add(loading);

    try {
      const buffer = await loading;
      this.#assertUsable();
      this.#buffers.set(name, buffer);

      return buffer;
    } finally {
      this.#pending.delete(loading);
    }
  }

  get(name: TName): AudioBuffer {
    this.#assertUsable();

    return this.#buffers.get(name) ?? AudioGraphError.missingResource("buffer", name);
  }

  has(name: TName): boolean {
    return this.#buffers.has(name);
  }

  set(name: TName, buffer: AudioBuffer): this {
    this.#assertUsable();
    this.#buffers.set(name, buffer);

    return this;
  }

  delete(name: TName): boolean {
    this.#assertUsable();

    return this.#buffers.delete(name);
  }

  clear(): void {
    this.#assertUsable();
    this.#buffers.clear();
  }

  dispose(): void {
    this.#disposed = true;
    this.#buffers.clear();
    this.#pending.clear();
  }

  #assertUsable(): void {
    if (this.#disposed) {
      AudioDisposedError.disposed("buffer collection");
    }
  }
}
