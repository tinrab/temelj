import type { AudioContextLike } from "../context/context.ts";
import type { TimeExpression } from "../time/time.ts";
import type { AudioDestination, AudioUnit, FadeCurve } from "../unit.ts";

import { getAudioContextImmediateTime, getNativeAudioContext } from "../context/context.ts";
import { AudioRangeError } from "../errors.ts";
import { connectTo, createBufferSourceNode, createGainNode, stopQuietly } from "../native.ts";
import { toSeconds } from "../time/time.ts";
import { AudioUnitBase } from "../unit.ts";
import { requireNonNegative } from "../validation.ts";

export function resolveAudioTime(time: TimeExpression, context: AudioContextLike): number {
  return toSeconds(time, { now: getAudioContextImmediateTime(context) });
}

export function toNonNegativeSeconds(time: TimeExpression, name: string): number {
  return requireNonNegative(toSeconds(time), name);
}

export function applyGainStartFade(options: {
  readonly curve: FadeCurve;
  readonly fadeIn: number;
  readonly gain: number;
  readonly param: AudioParam;
  readonly time: number;
}): void {
  const { curve, fadeIn, gain, param, time } = options;
  param.cancelScheduledValues(time);

  if (fadeIn === 0) {
    param.setValueAtTime(gain, time);

    return;
  }

  param.setValueAtTime(0, time);

  if (curve === "exponential") {
    param.setTargetAtTime(gain, time, Math.max(0.001, fadeIn / 3));

    return;
  }

  param.linearRampToValueAtTime(gain, time + fadeIn);
}

export function applyGainStopFade(options: {
  readonly curve: FadeCurve;
  readonly fadeOut: number;
  /**
   * Level the fade starts from, when known. Otherwise the fade starts from the last scheduled
   * value.
   */
  readonly from?: number;
  readonly param: AudioParam;
  readonly time: number;
}): void {
  const { curve, fadeOut, from, param, time } = options;
  param.cancelScheduledValues(time);

  if (from !== undefined) {
    param.setValueAtTime(from, time);
  }

  if (fadeOut === 0) {
    param.setValueAtTime(0, time);

    return;
  }

  if (curve === "exponential") {
    param.setTargetAtTime(0, time, Math.max(0.001, fadeOut / 3));

    return;
  }

  param.linearRampToValueAtTime(0, time + fadeOut);
}

/**
 * Runtime unit that ends in an output gain with volume and mute.
 */
export abstract class OutputUnit extends AudioUnitBase implements AudioUnit {
  readonly output: GainNode;
  #mute: boolean;
  #volume: number;

  constructor(
    context: AudioContextLike,
    options: { readonly mute?: boolean; readonly volume?: number },
  ) {
    super(context);
    this.#mute = options.mute === true;
    this.#volume = requireNonNegative(options.volume ?? 1, "volume");
    this.output = this.createGain(this.#mute ? 0 : this.#volume);
  }

  get mute(): boolean {
    return this.#mute;
  }

  /**
   * Output gain (linear).
   */
  get volume(): number {
    return this.#volume;
  }

  connect<TDestination extends AudioDestination>(destination: TDestination): TDestination {
    return connectTo(this.output, destination);
  }

  disconnect(): void {
    this.output.disconnect();
  }

  setMute(mute: boolean, time?: TimeExpression): void {
    this.#mute = mute;
    this.#applyOutputGain(time);
  }

  setVolume(volume: number, time?: TimeExpression): void {
    this.#volume = requireNonNegative(volume, "volume");
    this.#applyOutputGain(time);
  }

  protected resolveTime(time: TimeExpression | undefined): number {
    return resolveAudioTime(time ?? this.now(), this.context);
  }

  #applyOutputGain(time: TimeExpression | undefined): void {
    this.output.gain.setValueAtTime(this.#mute ? 0 : this.#volume, this.resolveTime(time));
  }
}

export type BufferVoiceOptions = {
  readonly buffer: AudioBuffer;
  readonly destination: AudioNode;
  readonly fadeCurve?: FadeCurve;
  readonly loop?: boolean;
  readonly loopEnd?: number;
  readonly loopStart?: number;
  readonly playbackRate?: number;
};

export type BufferVoiceStartOptions = {
  readonly time: number;
  /**
   * Buffer offset in seconds.
   */
  readonly offset?: number;
  /**
   * Buffer seconds to play; the voice stops itself afterwards. Omit to play to the end (or
   * forever when looping).
   */
  readonly duration?: number;
  readonly fadeIn?: number;
  readonly fadeOut?: number;
  /**
   * Peak gain after the fade-in.
   */
  readonly gain?: number;
};

/**
 * One buffer source playing through its own gain. It fades in when it starts and fades out when it
 * is stopped. Once it stops or ends, it removes itself from its owner's voice list.
 */
export class BufferVoice {
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
  readonly #context: AudioContextLike;
  readonly #owner: unknown[];
  readonly #fadeCurve: FadeCurve;
  readonly #onStop: ((voice: BufferVoice) => void) | undefined;
  #startedAt = 0;
  #offset = 0;
  #fadeIn = 0;
  #fadeOut = 0;
  #gain = 1;
  #stopped = false;
  #disposed = false;
  #finished = false;

  constructor(
    context: AudioContextLike,
    owner: unknown[],
    options: BufferVoiceOptions,
    onStop?: (voice: BufferVoice) => void,
  ) {
    const native = getNativeAudioContext(context);
    this.#context = context;
    this.#owner = owner;
    this.#fadeCurve = options.fadeCurve ?? "linear";
    this.#onStop = onStop;
    this.source = createBufferSourceNode(native, {
      buffer: options.buffer,
      loop: options.loop,
      loopEnd: options.loopEnd,
      loopStart: options.loopStart,
      playbackRate: options.playbackRate,
    });
    this.gain = createGainNode(native, { gain: 0 });
    this.source.connect(this.gain).connect(options.destination);
    this.source.onended = () => {
      this.dispose();
    };
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get stopped(): boolean {
    return this.#stopped;
  }

  get startedAt(): number {
    return this.#startedAt;
  }

  /**
   * Buffer offset the voice started from, in seconds.
   */
  get offset(): number {
    return this.#offset;
  }

  get playbackRate(): number {
    return this.source.playbackRate.value;
  }

  /**
   * Buffer position at `time`, ignoring loops.
   */
  positionAt(time: number): number {
    return this.#offset + Math.max(0, time - this.#startedAt) * this.playbackRate;
  }

  start({
    duration,
    fadeIn = 0,
    fadeOut = 0,
    gain = 1,
    offset = 0,
    time,
  }: BufferVoiceStartOptions): this {
    this.#startedAt = time;
    this.#offset = offset;
    this.#fadeIn = fadeIn;
    this.#fadeOut = fadeOut;
    this.#gain = gain;
    applyGainStartFade({ curve: this.#fadeCurve, fadeIn, gain, param: this.gain.gain, time });
    this.source.start(time, offset);

    if (duration !== undefined) {
      const endTime = time + duration / this.playbackRate;
      const fade = Math.min(fadeOut, endTime - time);

      if (fade > 0) {
        applyGainStopFade({
          curve: this.#fadeCurve,
          fadeOut: fade,
          from: gain,
          param: this.gain.gain,
          time: endTime - fade,
        });
      }

      stopQuietly(this.source, endTime);
    }

    return this;
  }

  /**
   * Fades out over `fadeOut` seconds from `time`, then stops the source. `fadeOut` defaults to the
   * fade-out given when the voice started. Later calls are ignored.
   */
  stop(
    time: number = getAudioContextImmediateTime(this.#context),
    fadeOut: number = this.#fadeOut,
  ): void {
    if (this.#stopped || this.#disposed) {
      return;
    }

    this.#stopped = true;
    applyGainStopFade({
      curve: this.#fadeCurve,
      fadeOut,
      from: this.#levelAt(time),
      param: this.gain.gain,
      time,
    });
    stopQuietly(this.source, time + fadeOut);
    this.#finish();
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
    this.source.onended = null;
    stopQuietly(this.source, getAudioContextImmediateTime(this.#context));
    this.source.disconnect();
    this.gain.disconnect();
    this.#finish();
  }

  /**
   * Gain the start fade reaches at `time`. Cancelling later automation does not hold this level,
   * so the stop fade has to start from it explicitly.
   */
  #levelAt(time: number): number {
    const elapsed = time - this.#startedAt;

    if (elapsed < 0) {
      return 0;
    }

    if (this.#fadeIn === 0) {
      return this.#gain;
    }

    if (this.#fadeCurve === "exponential") {
      const timeConstant = Math.max(0.001, this.#fadeIn / 3);

      return this.#gain * (1 - Math.exp(-elapsed / timeConstant));
    }

    return this.#gain * Math.min(1, elapsed / this.#fadeIn);
  }

  #finish(): void {
    if (this.#finished) {
      return;
    }

    this.#finished = true;
    const index = this.#owner.indexOf(this);

    if (index !== -1) {
      this.#owner.splice(index, 1);
    }

    this.#onStop?.(this);
  }
}

/**
 * Validates a fade curve read from untyped input.
 */
export function requireFadeCurve(curve: FadeCurve): FadeCurve {
  if (curve !== "linear" && curve !== "exponential") {
    AudioRangeError.invalidOption("fadeCurve", curve);
  }

  return curve;
}
