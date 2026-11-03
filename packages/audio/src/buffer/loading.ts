import { isObject, isString } from "@temelj/value";

import type { AudioContextLike } from "../context/context.ts";

import { decodeAudioData } from "../context/context.ts";
import { AudioLoadError, AudioUnsupportedError } from "../errors.ts";
import { isAudioBufferValue } from "../guards.ts";

export type AudioSourceValue = ArrayBuffer | ArrayBufferView | AudioBuffer | string | URL;

export type AudioSourceCandidateOptions = {
  readonly src: AudioSourceValue;
  readonly fetch?: RequestInit;
  /**
   * File format such as `"mp3"`, or a full MIME type.
   */
  readonly format?: string;
};

export type AudioSourceCandidate = AudioSourceValue | AudioSourceCandidateOptions;

/**
 * One source, or candidates tried in order until one is playable.
 */
export type AudioSourceInput = AudioSourceCandidate | readonly AudioSourceCandidate[];

export type AudioSourceSelectionOptions = {
  /**
   * Base URL that relative string sources resolve against.
   */
  readonly baseUrl?: string | URL;
  readonly fetch?: RequestInit;
  /**
   * Formats the caller supports. When set, `canPlayType` is not consulted.
   */
  readonly formats?: readonly string[];
};

export type SelectedAudioSourceCandidate = {
  readonly src: AudioSourceValue;
  readonly label: string;
  readonly fetch?: RequestInit;
  readonly format?: string;
};

const MIME_TYPES = new Map([
  ["flac", "audio/flac"],
  ["m4a", "audio/mp4"],
  ["mp3", "audio/mpeg"],
  ["mp4", "audio/mp4"],
  ["mpeg", "audio/mpeg"],
  ["oga", "audio/ogg"],
  ["ogg", "audio/ogg"],
  ["opus", "audio/ogg"],
  ["wav", "audio/wav"],
  ["wave", "audio/wav"],
  ["webm", "audio/webm"],
]);

/**
 * Joins a relative `source` path onto `baseUrl`. URLs with a scheme and root-relative paths are
 * returned unchanged, as is every source when `baseUrl` is missing or empty.
 */
export function resolveAudioUrl(source: string, baseUrl: string | URL | undefined): string {
  if (baseUrl === undefined || String(baseUrl) === "" || source.startsWith("/")) {
    return source;
  }

  if (/^[a-z][a-z\d+.-]*:/i.test(source)) {
    return source;
  }

  const base = String(baseUrl);

  return `${base.endsWith("/") ? base : `${base}/`}${source}`;
}

/**
 * Returns the lower-case format of a source: the MIME subtype of a `data:audio/...` URL, or the
 * file extension of a path.
 */
export function getAudioFormat(source: string | URL): string | undefined {
  const value = String(source).trim().toLowerCase();
  const dataMimeType = /^data:audio\/([^;,]+)/.exec(value)?.[1];

  if (dataMimeType !== undefined) {
    return dataMimeType;
  }

  const path = value.split(/[?#]/, 1)[0] ?? value;

  return /\.([a-z\d-]+)$/.exec(path)?.[1];
}

/**
 * Converts a format (`"mp3"`, `".ogg"`) or MIME type to a MIME type. Formats without a known
 * mapping become `audio/<format>`.
 */
export function getAudioMimeType(format: string): string {
  const normalized = format.trim().toLowerCase().replace(/^\./, "");

  if (normalized.includes("/")) {
    return normalized;
  }

  return MIME_TYPES.get(normalized) ?? `audio/${normalized}`;
}

/**
 * Strips parameters such as `codecs` from a MIME type.
 */
function getMimeEssence(mimeType: string): string {
  return mimeType.split(";", 1)[0]?.trim() ?? mimeType;
}

function isCandidateOptions(
  candidate: AudioSourceCandidate,
): candidate is AudioSourceCandidateOptions {
  return (
    isObject(candidate) &&
    "src" in candidate &&
    !isAudioBufferValue(candidate) &&
    !(candidate instanceof URL)
  );
}

function getSourceLabel(source: AudioSourceValue): string {
  if (isString(source) || source instanceof URL) {
    return String(source);
  }

  if (isAudioBufferValue(source)) {
    return "AudioBuffer";
  }

  return `${source.constructor.name}(${source.byteLength})`;
}

function mergeRequestInit(
  base: RequestInit | undefined,
  override: RequestInit | undefined,
): RequestInit | undefined {
  if (base === undefined || override === undefined) {
    return override ?? base;
  }

  const headers = new Headers(base.headers);
  new Headers(override.headers).forEach((value, key) => {
    headers.set(key, value);
  });

  return { ...base, ...override, headers };
}

function normalizeCandidate(
  candidate: AudioSourceCandidate,
  options: AudioSourceSelectionOptions,
): SelectedAudioSourceCandidate {
  const { src, fetch, format } = isCandidateOptions(candidate)
    ? candidate
    : { src: candidate, fetch: undefined, format: undefined };

  const resolved = isString(src) ? resolveAudioUrl(src, options.baseUrl) : src;

  return {
    fetch: mergeRequestInit(options.fetch, fetch),
    format,
    label: getSourceLabel(resolved),
    src: resolved,
  };
}

let canPlayTypeElement: HTMLAudioElement | undefined;

function canPlayMimeType(mimeType: string): boolean {
  if (globalThis.Audio === undefined) {
    return true;
  }

  canPlayTypeElement ??= new Audio();

  return canPlayTypeElement.canPlayType(mimeType) !== "";
}

function isPlayable(
  candidate: SelectedAudioSourceCandidate,
  options: AudioSourceSelectionOptions,
): boolean {
  const { src } = candidate;

  if (!isString(src) && !(src instanceof URL)) {
    return true;
  }

  const format = candidate.format ?? getAudioFormat(src);

  if (format === undefined) {
    return true;
  }

  if (options.formats !== undefined && options.formats.length > 0) {
    const essence = getMimeEssence(getAudioMimeType(format));

    return options.formats.some(
      (supported) => getMimeEssence(getAudioMimeType(supported)) === essence,
    );
  }

  return canPlayMimeType(getAudioMimeType(format));
}

/**
 * Normalizes candidates and keeps those the runtime (or `options.formats`) can play. Buffers are
 * always kept. So are sources whose format cannot be told from the URL or a `format` field; loading
 * decides whether those work.
 */
export function selectAudioSourceCandidates(
  source: AudioSourceCandidate | readonly AudioSourceCandidate[],
  options: AudioSourceSelectionOptions = {},
): readonly SelectedAudioSourceCandidate[] {
  const candidates: readonly AudioSourceCandidate[] = Array.isArray(source) ? source : [source];

  return candidates.flatMap((candidate) => {
    const selected = normalizeCandidate(candidate, options);

    return isPlayable(selected, options) ? [selected] : [];
  });
}

async function fetchAudioData(
  source: string | URL,
  init: RequestInit | undefined,
): Promise<ArrayBuffer> {
  if (globalThis.fetch === undefined) {
    return AudioUnsupportedError.missingApi("fetch");
  }

  const response = await fetch(source, init);

  if (!response.ok) {
    return AudioLoadError.fetchFailed(String(source), response.status);
  }

  return response.arrayBuffer();
}

function copyArrayBuffer(view: ArrayBufferView): ArrayBuffer {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice().buffer;
}

/**
 * Fetches (for URLs) and decodes audio data. Decoding failures reject with the error from the
 * context's `decodeAudioData()`.
 *
 * @throws {AudioUnsupportedError} When a URL is given and the runtime has no `fetch`.
 *
 * @throws {AudioLoadError} When the response has an error status.
 */
export async function loadAudioData(
  context: AudioContextLike,
  source: ArrayBuffer | ArrayBufferView | string | URL,
  init?: RequestInit,
): Promise<AudioBuffer> {
  if (source instanceof ArrayBuffer) {
    return decodeAudioData(context, source);
  }

  if (ArrayBuffer.isView(source)) {
    return decodeAudioData(context, copyArrayBuffer(source));
  }

  return decodeAudioData(context, await fetchAudioData(source, init));
}

/**
 * Loads the first playable candidate, trying the next one when loading fails.
 *
 * @throws {AudioLoadError} When no candidate is playable, or when none of several candidates loads;
 * the cause then holds every failure. A single candidate rethrows its own error.
 */
export async function loadAudio(
  context: AudioContextLike,
  source: AudioSourceCandidate | readonly AudioSourceCandidate[],
  options: AudioSourceSelectionOptions = {},
): Promise<AudioBuffer> {
  const candidates = selectAudioSourceCandidates(source, options);

  if (candidates.length === 0) {
    return Array.isArray(source) && source.length === 0
      ? AudioLoadError.noCandidates()
      : AudioLoadError.unsupportedFormat(String(source));
  }

  const [only] = candidates;

  if (candidates.length === 1 && only !== undefined) {
    return isAudioBufferValue(only.src) ? only.src : loadAudioData(context, only.src, only.fetch);
  }

  const errors: unknown[] = [];

  for (const candidate of candidates) {
    if (isAudioBufferValue(candidate.src)) {
      return candidate.src;
    }

    try {
      return await loadAudioData(context, candidate.src, candidate.fetch);
    } catch (error: unknown) {
      errors.push(error);
    }
  }

  return AudioLoadError.allCandidatesFailed(errors);
}
