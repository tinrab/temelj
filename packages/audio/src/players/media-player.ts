import type { PubSub } from "@temelj/event";

import { createPubSub } from "@temelj/event";
import { isFunction, isString } from "@temelj/value";

import type {
  AudioSourceInput,
  AudioSourceSelectionOptions,
  SelectedAudioSourceCandidate,
} from "../buffer/loading.ts";
import type { AudioContextLike } from "../context/context.ts";
import type { AudioDestination, AudioUnit, PlaybackState } from "../unit.ts";

import {
  getAudioFormat,
  getAudioMimeType,
  selectAudioSourceCandidates,
} from "../buffer/loading.ts";
import { getNativeAudioContext } from "../context/context.ts";
import { AudioDisposedError, AudioLoadError, AudioUnsupportedError } from "../errors.ts";
import { connectTo, createGainNode, createMediaElementSourceNode } from "../native.ts";
import { requireInRange, requireNonNegative, requirePositive } from "../validation.ts";

export type MediaElementPreload = "auto" | "metadata" | "none";

export type MediaElementPlayerOptions = AudioSourceSelectionOptions & {
  readonly autostart?: boolean;
  readonly element?: HTMLAudioElement;
  readonly loop?: boolean;
  readonly mute?: boolean;
  readonly playbackRate?: number;
  readonly preload?: MediaElementPreload;
  readonly source?: AudioSourceInput;
  readonly volume?: number;
};

type MediaPlayerEvent = { readonly player: MediaElementPlayer };

type MediaPlayerElementEvent = MediaPlayerEvent & { readonly event: Event };

export type MediaElementPlayerEvents = {
  readonly end: MediaPlayerElementEvent;
  readonly error: MediaPlayerElementEvent;
  readonly load: MediaPlayerElementEvent;
  readonly mute: MediaPlayerEvent;
  readonly pause: MediaPlayerElementEvent;
  readonly play: MediaPlayerElementEvent;
  readonly rate: MediaPlayerEvent;
  readonly seek: MediaPlayerEvent;
  readonly stop: MediaPlayerEvent;
  readonly volume: MediaPlayerEvent;
};

/**
 * Streams an `HTMLAudioElement`, optionally routed into Web Audio through `output`. Use it for long
 * files and live streams: the buffer-based players decode the whole file into memory before
 * playing.
 */
export class MediaElementPlayer implements AudioUnit {
  readonly element: HTMLAudioElement;
  readonly events: PubSub<MediaElementPlayerEvents> = createPubSub<MediaElementPlayerEvents>();
  readonly output: GainNode | undefined;
  readonly sourceNode: MediaElementAudioSourceNode | undefined;
  readonly #unbind: () => void;
  #loaded: boolean;
  #state: PlaybackState;
  #disposed = false;

  /**
   * Without a context the element plays directly and `connect()` is unavailable.
   */
  constructor(context: AudioContextLike | undefined, options: MediaElementPlayerOptions = {}) {
    const element = options.element ?? createAudioElement();
    this.element = element;
    element.preload = options.preload ?? "auto";
    element.loop = options.loop ?? element.loop;
    element.muted = options.mute === true;
    element.volume = requireInRange(options.volume ?? element.volume, 0, 1, "volume");
    element.playbackRate = requirePositive(
      options.playbackRate ?? element.playbackRate,
      "playbackRate",
    );

    if (options.source !== undefined) {
      applyMediaSources(element, options.source, options);
    }

    this.#loaded = element.readyState > 0;
    this.#state = element.paused ? "stopped" : "started";

    if (context !== undefined) {
      const native = getNativeAudioContext(context);
      this.sourceNode = createMediaElementSourceNode(native, element);
      this.output = createGainNode(native);
      this.sourceNode.connect(this.output);
    }

    this.#unbind = bindElementEvents(element, {
      end: (event) => {
        this.#state = "stopped";
        this.events.emit("end", { event, player: this });
      },
      error: (event) => {
        this.events.emit("error", { event, player: this });
      },
      load: (event) => {
        this.#loaded = true;
        this.events.emit("load", { event, player: this });
      },
      pause: (event) => {
        // Elements fire `pause` asynchronously, so after stop() it arrives once already stopped.
        if (this.#state !== "stopped") {
          this.#state = "paused";
          this.events.emit("pause", { event, player: this });
        }
      },
      play: (event) => {
        this.#state = "started";
        this.events.emit("play", { event, player: this });
      },
    });

    if (options.autostart === true) {
      this.play().catch(() => {
        // Browsers block autoplay without a user gesture; call play() again from one.
      });
    }
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get loaded(): boolean {
    return this.#loaded;
  }

  get loop(): boolean {
    return this.element.loop;
  }

  get mute(): boolean {
    return this.element.muted;
  }

  get playbackRate(): number {
    return this.element.playbackRate;
  }

  /**
   * Playback position in seconds.
   */
  get progress(): number {
    return Number.isFinite(this.element.currentTime) ? this.element.currentTime : 0;
  }

  get state(): PlaybackState {
    return this.#state;
  }

  get volume(): number {
    return this.element.volume;
  }

  connect<TDestination extends AudioDestination>(destination: TDestination): TDestination {
    this.#assertUsable();
    const output = this.output ?? AudioUnsupportedError.missingApi("MediaElementAudioSourceNode");

    return connectTo(output, destination);
  }

  disconnect(): void {
    this.output?.disconnect();
  }

  async play(): Promise<void> {
    this.#assertUsable();
    await this.element.play();
    this.#state = "started";
  }

  pause(): void {
    this.#assertUsable();
    this.element.pause();
    this.#state = "paused";
  }

  /**
   * Pauses and rewinds to the start.
   */
  stop(): void {
    this.#assertUsable();
    this.#state = "stopped";
    this.element.pause();
    this.element.currentTime = 0;
    this.events.emit("stop", { player: this });
  }

  seek(offset: number): void {
    this.#assertUsable();
    this.element.currentTime = requireNonNegative(offset, "offset");
    this.events.emit("seek", { player: this });
  }

  setLoop(loop: boolean): void {
    this.#assertUsable();
    this.element.loop = loop;
  }

  setMute(mute: boolean): void {
    this.#assertUsable();
    this.element.muted = mute;
    this.events.emit("mute", { player: this });
  }

  setPlaybackRate(playbackRate: number): void {
    this.#assertUsable();
    this.element.playbackRate = requirePositive(playbackRate, "playbackRate");
    this.events.emit("rate", { player: this });
  }

  setVolume(volume: number): void {
    this.#assertUsable();
    this.element.volume = requireInRange(volume, 0, 1, "volume");
    this.events.emit("volume", { player: this });
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
    this.#state = "stopped";
    this.#unbind();
    this.element.pause();
    this.sourceNode?.disconnect();
    this.output?.disconnect();
    this.events.clear();
  }

  #assertUsable(): void {
    if (this.#disposed) {
      AudioDisposedError.disposed("media element player");
    }
  }
}

type ElementEventHandlers = {
  readonly end: (event: Event) => void;
  readonly error: (event: Event) => void;
  readonly load: (event: Event) => void;
  readonly pause: (event: Event) => void;
  readonly play: (event: Event) => void;
};

function bindElementEvents(element: HTMLAudioElement, handlers: ElementEventHandlers): () => void {
  const entries: Array<readonly [string, EventListener]> = [
    ["ended", handlers.end],
    ["error", handlers.error],
    ["loadedmetadata", handlers.load],
    ["pause", handlers.pause],
    ["play", handlers.play],
  ];

  for (const [type, listener] of entries) {
    element.addEventListener(type, listener);
  }

  return () => {
    for (const [type, listener] of entries) {
      element.removeEventListener(type, listener);
    }
  };
}

function applyMediaSources(
  element: HTMLAudioElement,
  source: AudioSourceInput,
  options: AudioSourceSelectionOptions,
): void {
  const selected = selectAudioSourceCandidates(source, options).filter(isStringMediaSource);

  if (selected.length === 0) {
    AudioLoadError.noCandidates();
  }

  if (selected.length > 1 && canUseSourceElements(element)) {
    removeSourceElements(element);

    for (const candidate of selected) {
      element.appendChild(createSourceElement(candidate));
    }

    element.removeAttribute("src");
    element.load();

    return;
  }

  const candidate = selected[0]!;
  element.src = String(candidate.src);
  element.load();
}

function isStringMediaSource(
  candidate: SelectedAudioSourceCandidate,
): candidate is SelectedAudioSourceCandidate & { readonly src: string | URL } {
  return isString(candidate.src) || candidate.src instanceof URL;
}

function canUseSourceElements(element: HTMLAudioElement): boolean {
  return (
    globalThis.document?.createElement instanceof Function &&
    element.appendChild instanceof Function &&
    element.querySelectorAll instanceof Function
  );
}

function removeSourceElements(element: HTMLAudioElement): void {
  for (const source of Array.from(element.querySelectorAll("source"))) {
    source.remove();
  }
}

function createSourceElement(
  candidate: SelectedAudioSourceCandidate & { readonly src: string | URL },
): HTMLSourceElement {
  const source = globalThis.document.createElement("source");
  source.src = String(candidate.src);
  const type = getMediaSourceMimeType(candidate);

  if (type) {
    source.type = type;
  }

  return source;
}

function getMediaSourceMimeType(
  candidate: SelectedAudioSourceCandidate & { readonly src: string | URL },
): string | undefined {
  const format = candidate.format ?? getAudioFormat(candidate.src);

  return format === undefined ? undefined : getAudioMimeType(format);
}

function createAudioElement(): HTMLAudioElement {
  // SAFETY: `Audio` is missing outside the DOM; it is checked before use.
  const AudioCtor = (globalThis as { readonly Audio?: new () => HTMLAudioElement }).Audio;

  if (isFunction(AudioCtor)) {
    return new AudioCtor();
  }

  if (globalThis.document?.createElement instanceof Function) {
    return globalThis.document.createElement("audio");
  }

  return AudioUnsupportedError.missingApi("HTMLAudioElement");
}
