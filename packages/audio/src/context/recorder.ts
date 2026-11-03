import { isFunction, isString } from "@temelj/value";

import type { PlaybackState } from "../unit.ts";
import type { AudioContextLike } from "./context.ts";

import { AudioDisposedError, AudioUnsupportedError } from "../errors.ts";
import { createMediaStreamDestinationNode } from "../native.ts";
import { AudioUnitBase } from "../unit.ts";

const DEFAULT_AUDIO_RECORDER_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4",
] as const;

export type AudioRecorderOptions = MediaRecorderOptions;

export type AudioRecordingFileNameOptions = {
  readonly fallbackExtension?: string;
  readonly name?: string;
};

type MediaRecorderConstructor = new (
  stream: MediaStream,
  options?: MediaRecorderOptions,
) => MediaRecorder;

/**
 * Returns whether `MediaRecorder` is available and, when `mimeType` is given, whether it can record
 * that type. Runtimes without `MediaRecorder.isTypeSupported()` are assumed to support every type.
 */
export function isMediaRecorderSupported(mimeType?: string): boolean {
  const MediaRecorderCtor = getMediaRecorderConstructor();

  if (!isFunction(MediaRecorderCtor)) {
    return false;
  }

  if (mimeType === undefined) {
    return true;
  }

  if (!isFunction(MediaRecorderCtor.isTypeSupported)) {
    return true;
  }

  return MediaRecorderCtor.isTypeSupported(mimeType);
}

/**
 * Returns the first of `mimeTypes` that `MediaRecorder` can record, or `undefined` when none is
 * supported. The default list tries WebM before Ogg, asking for Opus first in each. MP4 comes last.
 */
export function getSupportedAudioRecorderMimeType(
  mimeTypes: readonly string[] = DEFAULT_AUDIO_RECORDER_MIME_TYPES,
): string | undefined {
  for (const mimeType of mimeTypes) {
    if (isMediaRecorderSupported(mimeType)) {
      return mimeType;
    }
  }

  return undefined;
}

/**
 * Creates an object URL for a recording. Release it with `revokeAudioRecordingUrl()`.
 *
 * @throws {AudioUnsupportedError} When `URL.createObjectURL()` is not available.
 */
export function createAudioRecordingUrl(blob: Blob): string {
  if (!(globalThis.URL?.createObjectURL instanceof Function)) {
    AudioUnsupportedError.missingApi("URL.createObjectURL");
  }

  return globalThis.URL.createObjectURL(blob);
}

/**
 * Releases an object URL created by `createAudioRecordingUrl()`. Does nothing when the runtime
 * cannot revoke URLs.
 */
export function revokeAudioRecordingUrl(url: string): void {
  if (globalThis.URL?.revokeObjectURL instanceof Function) {
    globalThis.URL.revokeObjectURL(url);
  }
}

/**
 * Returns the usual file extension for an audio MIME type (`audio/mpeg` → `mp3`), or the sanitized
 * `fallback` (`webm` by default) for unknown types.
 */
export function getAudioRecordingFileExtension(
  mimeType: string | undefined,
  fallback = "webm",
): string {
  if (!isString(mimeType) || mimeType.length === 0) {
    return sanitizeFileExtension(fallback);
  }

  const [type] = mimeType.toLowerCase().split(";");

  switch (type) {
    case "audio/mpeg":
    case "audio/mp3":
      return "mp3";
    case "audio/mp4":
    case "audio/x-m4a":
      return "m4a";
    case "audio/ogg":
      return "ogg";
    case "audio/wav":
    case "audio/wave":
    case "audio/x-wav":
      return "wav";
    case "audio/webm":
      return "webm";
    default:
      return sanitizeFileExtension(fallback);
  }
}

/**
 * Returns a safe file name for a recording: `options.name` (default `recording`) with unsafe
 * characters replaced, plus the extension for `mimeType`.
 */
export function createAudioRecordingFileName(
  mimeType: string | undefined,
  options: AudioRecordingFileNameOptions = {},
): string {
  const name = sanitizeFileName(options.name ?? "recording");
  const extension = getAudioRecordingFileExtension(mimeType, options.fallbackExtension);

  return `${name}.${extension}`;
}

/**
 * Records whatever is connected to `input` with `MediaRecorder`.
 */
export class AudioRecorder extends AudioUnitBase {
  readonly destination: MediaStreamAudioDestinationNode;
  readonly recorder: MediaRecorder;
  readonly #mimeType: string | undefined;
  readonly #chunks: BlobPart[] = [];

  constructor(context: AudioContextLike, options: AudioRecorderOptions = {}) {
    super(context);

    const Recorder =
      getMediaRecorderConstructor() ?? AudioUnsupportedError.missingApi("MediaRecorder");

    this.#mimeType = options.mimeType;
    this.destination = this.nodes.add(createMediaStreamDestinationNode(this.native));
    this.recorder = new Recorder(this.destination.stream, options);
    this.recorder.addEventListener("dataavailable", this.#onData);
  }

  get input(): MediaStreamAudioDestinationNode {
    return this.destination;
  }

  get stream(): MediaStream {
    return this.destination.stream;
  }

  get mimeType(): string {
    return this.recorder.mimeType;
  }

  get state(): PlaybackState {
    return getAudioRecorderState(this.recorder.state);
  }

  /**
   * Starts or resumes recording. Resolves once the recorder reports it started.
   */
  start(timeslice?: number): Promise<void> {
    this.#assertOpen();
    const recorder = this.recorder;

    if (recorder.state === "recording") {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        recorder.removeEventListener("start", onStart);
        recorder.removeEventListener("resume", onStart);
        recorder.removeEventListener("error", onError);
      };

      const onStart = (): void => {
        cleanup();
        resolve();
      };

      const onError = (event: Event): void => {
        cleanup();
        reject(getMediaRecorderError(event));
      };

      recorder.addEventListener("start", onStart, { once: true });
      recorder.addEventListener("resume", onStart, { once: true });
      recorder.addEventListener("error", onError, { once: true });

      if (recorder.state === "paused") {
        recorder.resume();
      } else {
        recorder.start(timeslice);
      }
    });
  }

  pause(): void {
    this.#assertOpen();

    if (this.recorder.state === "recording") {
      this.recorder.pause();
    }
  }

  requestData(): void {
    this.#assertOpen();

    if (this.recorder.state !== "inactive") {
      this.recorder.requestData();
    }
  }

  /**
   * Stops recording and resolves with everything recorded since the last stop.
   */
  stop(): Promise<Blob> {
    this.#assertOpen();
    const recorder = this.recorder;

    if (recorder.state === "inactive") {
      return Promise.resolve(this.#takeBlob());
    }

    return new Promise<Blob>((resolve, reject) => {
      const cleanup = (): void => {
        recorder.removeEventListener("stop", onStop);
        recorder.removeEventListener("error", onError);
      };

      const onStop = (): void => {
        cleanup();
        resolve(this.#takeBlob());
      };

      const onError = (event: Event): void => {
        cleanup();
        reject(getMediaRecorderError(event));
      };

      recorder.addEventListener("stop", onStop, { once: true });
      recorder.addEventListener("error", onError, { once: true });
      recorder.stop();
    });
  }

  protected override teardown(): void {
    this.recorder.removeEventListener("dataavailable", this.#onData);

    if (this.recorder.state !== "inactive") {
      this.recorder.stop();
    }
  }

  readonly #onData = (event: BlobEvent): void => {
    if (event.data.size > 0) {
      this.#chunks.push(event.data);
    }
  };

  #takeBlob(): Blob {
    return new Blob(this.#chunks.splice(0), { type: this.recorder.mimeType || this.#mimeType });
  }

  #assertOpen(): void {
    if (this.disposed) {
      AudioDisposedError.disposed("audio recorder");
    }
  }
}

function getAudioRecorderState(state: MediaRecorder["state"]): PlaybackState {
  if (state === "inactive") {
    return "stopped";
  }

  if (state === "recording") {
    return "started";
  }

  return "paused";
}

function getMediaRecorderError(event: Event): Error {
  // SAFETY: `MediaRecorder` error events carry an `error` property that `Event` does not declare.
  const error = (event as { readonly error?: unknown }).error;

  return error instanceof Error ? error : new DOMException("audio recording failed");
}

function getMediaRecorderConstructor():
  | (MediaRecorderConstructor & {
      isTypeSupported?: (mimeType: string) => boolean;
    })
  | undefined {
  if (typeof globalThis === "undefined" || !isFunction(globalThis.MediaRecorder)) {
    return undefined;
  }

  // SAFETY: `isTypeSupported` is a static member that the constructor type omits.
  return globalThis.MediaRecorder as MediaRecorderConstructor & {
    isTypeSupported?: (mimeType: string) => boolean;
  };
}

function sanitizeFileName(value: string): string {
  const name = value
    .trim()
    .replaceAll(/[^A-Za-z0-9._-]+/g, "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^[.-]+|[.-]+$/g, "");

  return name.length > 0 ? name : "recording";
}

function sanitizeFileExtension(value = "webm"): string {
  const extension = value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "");

  return extension.length > 0 ? extension : "webm";
}
