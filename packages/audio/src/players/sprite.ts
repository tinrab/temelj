import type { PubSub } from "@temelj/event";

import { createPubSub } from "@temelj/event";

import type { AudioSourceInput } from "../buffer/loading.ts";
import type { AudioContextLike } from "../context/context.ts";
import type { TimeExpression } from "../time/time.ts";
import type { FadeCurve, PlaybackState, RunState } from "../unit.ts";

import { resolveAudioBuffer } from "../buffer/source.ts";
import { getAudioContextImmediateTime } from "../context/context.ts";
import { AudioDisposedError, AudioGraphError } from "../errors.ts";
import { toSeconds } from "../time/time.ts";
import { requireNonNegative, requirePositive } from "../validation.ts";
import {
  BufferVoice,
  OutputUnit,
  requireFadeCurve,
  resolveAudioTime,
  toNonNegativeSeconds,
} from "./playback.ts";

/**
 * A named buffer region: `[offset, duration]` or `[offset, duration, loop]`.
 */
export type SpriteDefinition =
  | readonly [offset: TimeExpression, duration: TimeExpression]
  | readonly [offset: TimeExpression, duration: TimeExpression, loop: boolean];

export type SpritePlayerOptions<TName extends string = string> = {
  readonly fadeCurve?: FadeCurve;
  readonly fadeIn?: TimeExpression;
  readonly fadeOut?: TimeExpression;
  readonly mute?: boolean;
  readonly playbackRate?: number;
  readonly sprites: Readonly<Record<TName, SpriteDefinition>>;
  readonly volume?: number;
};

export type SpritePlayOptions = {
  readonly fadeIn?: TimeExpression;
  readonly fadeOut?: TimeExpression;
  readonly loop?: boolean;
  readonly mute?: boolean;
  readonly playbackRate?: number;
  /**
   * Position inside the sprite to start from.
   */
  readonly seek?: TimeExpression;
  readonly time?: TimeExpression;
  readonly volume?: number;
};

export type SpriteEvents<TName extends string = string> = {
  readonly end: { readonly voice: SpriteVoice<TName> };
  readonly fade: { readonly voice: SpriteVoice<TName> };
  readonly mute: { readonly voice: SpriteVoice<TName>; readonly mute: boolean };
  readonly pause: { readonly voice: SpriteVoice<TName> };
  readonly play: { readonly voice: SpriteVoice<TName> };
  readonly rate: { readonly voice: SpriteVoice<TName>; readonly playbackRate: number };
  readonly seek: { readonly voice: SpriteVoice<TName>; readonly offset: number };
  readonly stop: { readonly voice: SpriteVoice<TName> };
  readonly volume: { readonly voice: SpriteVoice<TName>; readonly volume: number };
};

/**
 * Selects voices for group operations by voice id or sprite name. `undefined` selects every voice
 * that has not been stopped, paused ones included.
 */
export type SpriteTarget<TName extends string> = number | TName | undefined;

type Sprite = {
  readonly duration: number;
  readonly loop: boolean;
  readonly offset: number;
};

type SpriteVoiceHost<TName extends string> = {
  readonly buffer: AudioBuffer;
  readonly context: AudioContextLike;
  readonly destination: AudioNode;
  readonly events: PubSub<SpriteEvents<TName>>;
  readonly fadeCurve: FadeCurve;
  readonly voices: SpriteVoice<TName>[];
};

/**
 * One playing sprite. The voice stays valid across `pause()` and `seek()`; each `resume()` starts a
 * new buffer source for the rest of the region.
 */
export class SpriteVoice<TName extends string = string> {
  readonly id: number;
  readonly name: TName;
  readonly #host: SpriteVoiceHost<TName>;
  readonly #sprite: Sprite;
  readonly #fadeIn: number;
  readonly #fadeOut: number;
  readonly #segments: BufferVoice[] = [];
  #segment: BufferVoice | undefined;
  #state: PlaybackState = "stopped";
  #position: number;
  #loop: boolean;
  #mute: boolean;
  #volume: number;
  #playbackRate: number;
  #disposed = false;

  constructor(
    host: SpriteVoiceHost<TName>,
    id: number,
    name: TName,
    sprite: Sprite,
    options: SpritePlayOptions & {
      readonly fadeIn: number;
      readonly fadeOut: number;
      readonly playbackRate: number;
    },
  ) {
    this.#host = host;
    this.id = id;
    this.name = name;
    this.#sprite = sprite;
    this.#fadeIn = options.fadeIn;
    this.#fadeOut = options.fadeOut;
    this.#loop = options.loop ?? sprite.loop;
    this.#mute = options.mute === true;
    this.#volume = requireNonNegative(options.volume ?? 1, "volume");
    this.#playbackRate = requirePositive(options.playbackRate, "playbackRate");
    this.#position = clampTime(toSeconds(options.seek ?? 0), sprite.duration);
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get duration(): number {
    return this.#sprite.duration;
  }

  get offset(): number {
    return this.#sprite.offset;
  }

  get loop(): boolean {
    return this.#loop;
  }

  get mute(): boolean {
    return this.#mute;
  }

  get playbackRate(): number {
    return this.#playbackRate;
  }

  get volume(): number {
    return this.#volume;
  }

  get state(): PlaybackState {
    return this.#state;
  }

  get source(): AudioBufferSourceNode | undefined {
    return this.#segment?.source;
  }

  /**
   * Position inside the sprite, in seconds.
   */
  get progress(): number {
    if (this.#segment === undefined || this.#state !== "started") {
      return this.#position;
    }

    const position = this.#segment.positionAt(this.#now()) - this.#sprite.offset;

    return this.#loop
      ? positiveModulo(position, this.#sprite.duration)
      : clampTime(position, this.#sprite.duration);
  }

  /**
   * Plays from the current position. Does nothing while playing.
   */
  resume(time?: TimeExpression): void {
    if (this.#disposed || this.#state === "started") {
      return;
    }

    const segment = new BufferVoice(
      this.#host.context,
      this.#segments,
      {
        buffer: this.#host.buffer,
        destination: this.#host.destination,
        fadeCurve: this.#host.fadeCurve,
        loop: this.#loop,
        loopEnd: this.#sprite.offset + this.#sprite.duration,
        loopStart: this.#sprite.offset,
        playbackRate: this.#playbackRate,
      },
      (ended) => {
        this.#onSegmentStop(ended);
      },
    );

    this.#segments.push(segment);
    this.#segment = segment;
    this.#state = "started";
    segment.start({
      duration: this.#loop ? undefined : this.#sprite.duration - this.#position,
      fadeIn: this.#fadeIn,
      fadeOut: this.#fadeOut,
      gain: this.#gain,
      offset: this.#sprite.offset + this.#position,
      time: this.#resolve(time),
    });
    this.#host.events.emit("play", { voice: this });
  }

  pause(time?: TimeExpression): void {
    if (this.#disposed || this.#state !== "started") {
      return;
    }

    this.#position = this.progress;
    this.#state = "paused";
    this.#endSegment(this.#resolve(time), 0);
    this.#host.events.emit("pause", { voice: this });
  }

  /**
   * Fades out and forgets the voice.
   */
  stop(time?: TimeExpression): void {
    if (this.#disposed || this.#state === "stopped") {
      return;
    }

    this.#position = 0;
    this.#state = "stopped";
    this.#endSegment(this.#resolve(time), this.#fadeOut);
    this.#leaveHost();
    this.#host.events.emit("stop", { voice: this });
  }

  seek(offset: TimeExpression, time?: TimeExpression): void {
    this.#position = clampTime(toSeconds(offset), this.#sprite.duration);

    if (this.#state === "started") {
      this.#state = "paused";
      this.#endSegment(this.#resolve(time), 0);
      this.resume(time);
    }

    this.#host.events.emit("seek", { voice: this, offset: this.#position });
  }

  fade(volume: number, duration: TimeExpression): void {
    this.#volume = requireNonNegative(volume, "volume");
    const now = this.#now();
    const endTime = now + toNonNegativeSeconds(duration, "duration");
    const param = this.#segment?.gain.gain;

    // Anchor the ramp at the current level; otherwise it is measured from the segment's start.
    param?.setValueAtTime(param.value, now);
    param?.linearRampToValueAtTime(this.#gain, endTime);
    this.#host.events.emit("fade", { voice: this });
  }

  setMute(mute: boolean, time?: TimeExpression): void {
    this.#mute = mute;
    this.#segment?.gain.gain.setValueAtTime(this.#gain, this.#resolve(time));
    this.#host.events.emit("mute", { voice: this, mute });
  }

  setPlaybackRate(playbackRate: number, time?: TimeExpression): void {
    this.#playbackRate = requirePositive(playbackRate, "playbackRate");
    this.#segment?.source.playbackRate.setValueAtTime(this.#playbackRate, this.#resolve(time));
    this.#host.events.emit("rate", { voice: this, playbackRate: this.#playbackRate });
  }

  setVolume(volume: number, time?: TimeExpression): void {
    this.#volume = requireNonNegative(volume, "volume");
    this.#segment?.gain.gain.setValueAtTime(this.#gain, this.#resolve(time));
    this.#host.events.emit("volume", { voice: this, volume: this.#volume });
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
    this.#state = "stopped";
    this.#segment = undefined;

    for (const segment of Array.from(this.#segments)) {
      segment.dispose();
    }

    this.#leaveHost();
  }

  get #gain(): number {
    return this.#mute ? 0 : this.#volume;
  }

  #now(): number {
    return getAudioContextImmediateTime(this.#host.context);
  }

  #resolve(time: TimeExpression | undefined): number {
    return resolveAudioTime(time ?? this.#now(), this.#host.context);
  }

  #endSegment(time: number, fadeOut: number): void {
    const segment = this.#segment;
    this.#segment = undefined;
    segment?.stop(time, fadeOut);
  }

  #onSegmentStop(segment: BufferVoice): void {
    // Only a segment that ends on its own, not one the voice paused or stopped, ends the voice.
    if (segment !== this.#segment || this.#state !== "started") {
      return;
    }

    this.#segment = undefined;
    this.#state = "stopped";
    this.#position = 0;
    this.#leaveHost();
    this.#host.events.emit("end", { voice: this });
  }

  #leaveHost(): void {
    const index = this.#host.voices.indexOf(this);

    if (index !== -1) {
      this.#host.voices.splice(index, 1);
    }
  }
}

/**
 * Plays named regions of one buffer. Each `play()` returns a `SpriteVoice` for controlling that
 * sound, and group methods select voices by id or sprite name.
 */
export class SpritePlayer<TName extends string = string> extends OutputUnit {
  readonly buffer: AudioBuffer;
  readonly events: PubSub<SpriteEvents<TName>> = createPubSub<SpriteEvents<TName>>();
  readonly #sprites: ReadonlyMap<TName, Sprite>;
  readonly #voices: SpriteVoice<TName>[] = [];
  #fadeCurve: FadeCurve;
  #fadeIn: number;
  #fadeOut: number;
  #playbackRate: number;
  #nextId = 1;

  constructor(context: AudioContextLike, buffer: AudioBuffer, options: SpritePlayerOptions<TName>) {
    super(context, options);
    this.buffer = buffer;
    this.#sprites = normalizeSprites(options.sprites, buffer.duration);
    this.#fadeCurve = requireFadeCurve(options.fadeCurve ?? "linear");
    this.#fadeIn = toNonNegativeSeconds(options.fadeIn ?? 0, "fadeIn");
    this.#fadeOut = toNonNegativeSeconds(options.fadeOut ?? 0, "fadeOut");
    this.#playbackRate = requirePositive(options.playbackRate ?? 1, "playbackRate");
  }

  static async load<TName extends string>(
    context: AudioContextLike,
    source: AudioSourceInput,
    options: SpritePlayerOptions<TName>,
  ): Promise<SpritePlayer<TName>> {
    return new SpritePlayer(context, await resolveAudioBuffer(context, source), options);
  }

  get activeVoices(): readonly SpriteVoice<TName>[] {
    return [...this.#voices];
  }

  get fadeCurve(): FadeCurve {
    return this.#fadeCurve;
  }

  get fadeIn(): number {
    return this.#fadeIn;
  }

  get fadeOut(): number {
    return this.#fadeOut;
  }

  get names(): readonly TName[] {
    return [...this.#sprites.keys()];
  }

  get playbackRate(): number {
    return this.#playbackRate;
  }

  get state(): RunState {
    return this.#voices.some((voice) => voice.state === "started") ? "started" : "stopped";
  }

  play(name: TName, options: SpritePlayOptions = {}): SpriteVoice<TName> {
    if (this.disposed) {
      AudioDisposedError.disposed("sprite player");
    }

    const sprite = this.#sprites.get(name) ?? AudioGraphError.missingResource("sprite", name);

    const voice = new SpriteVoice<TName>(
      {
        buffer: this.buffer,
        context: this.context,
        destination: this.output,
        events: this.events,
        fadeCurve: this.#fadeCurve,
        voices: this.#voices,
      },
      this.#nextId,
      name,
      sprite,
      {
        ...options,
        fadeIn: toNonNegativeSeconds(options.fadeIn ?? this.#fadeIn, "fadeIn"),
        fadeOut: toNonNegativeSeconds(options.fadeOut ?? this.#fadeOut, "fadeOut"),
        playbackRate: options.playbackRate ?? this.#playbackRate,
      },
    );

    this.#nextId += 1;
    this.#voices.push(voice);
    voice.resume(options.time);

    return voice;
  }

  /**
   * Active voices matching `target`.
   */
  voices(target?: SpriteTarget<TName>): readonly SpriteVoice<TName>[] {
    return target === undefined
      ? this.activeVoices
      : this.#voices.filter((voice) => voice.id === target || voice.name === target);
  }

  fade(volume: number, duration: TimeExpression, target?: SpriteTarget<TName>): void {
    for (const voice of this.voices(target)) {
      voice.fade(volume, duration);
    }
  }

  pause(target?: SpriteTarget<TName>, time?: TimeExpression): void {
    for (const voice of this.voices(target)) {
      voice.pause(time);
    }
  }

  seek(offset: TimeExpression, target?: SpriteTarget<TName>, time?: TimeExpression): void {
    for (const voice of this.voices(target)) {
      voice.seek(offset, time);
    }
  }

  stop(target?: SpriteTarget<TName>, time?: TimeExpression): void {
    for (const voice of this.voices(target)) {
      voice.stop(time);
    }
  }

  setFadeCurve(curve: FadeCurve): void {
    this.#fadeCurve = requireFadeCurve(curve);
  }

  setFadeIn(fadeIn: TimeExpression): void {
    this.#fadeIn = toNonNegativeSeconds(fadeIn, "fadeIn");
  }

  setFadeOut(fadeOut: TimeExpression): void {
    this.#fadeOut = toNonNegativeSeconds(fadeOut, "fadeOut");
  }

  /**
   * Sets the default rate for new voices and applies it to playing ones.
   */
  setPlaybackRate(playbackRate: number, time?: TimeExpression): void {
    this.#playbackRate = requirePositive(playbackRate, "playbackRate");

    for (const voice of this.#voices) {
      voice.setPlaybackRate(this.#playbackRate, time);
    }
  }

  protected override teardown(): void {
    for (const voice of Array.from(this.#voices)) {
      voice.dispose();
    }

    this.events.clear();
  }
}

function normalizeSprites<TName extends string>(
  sprites: Readonly<Record<TName, SpriteDefinition>>,
  bufferDuration: number,
): Map<TName, Sprite> {
  const map = new Map<TName, Sprite>();

  // SAFETY: `Object.entries` widens the keys of a `Record<TName, …>` to string.
  for (const [name, [offset, duration, loop]] of Object.entries(sprites) as [
    TName,
    SpriteDefinition,
  ][]) {
    const start = clampTime(toSeconds(offset), bufferDuration);
    map.set(name, {
      duration: clampTime(toSeconds(duration), bufferDuration - start),
      loop: loop === true,
      offset: start,
    });
  }

  return map;
}

function clampTime(value: number, max: number): number {
  return Math.min(max, Math.max(0, requireNonNegative(value, "time")));
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
