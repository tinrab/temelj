import { isNumber } from "@temelj/value";

import type { AudioContextLike } from "../context/context.ts";
import type { RunState } from "../unit.ts";

import { createAudioBuffer } from "../buffer/creation.ts";
import { getNativeAudioContext } from "../context/context.ts";
import { BufferVoice, OutputUnit } from "../players/playback.ts";
import {
  floorNonNegative,
  floorPositive,
  requireNonNegative,
  requirePositive,
  snapToFrame,
} from "../validation.ts";

export type NoiseType = "brown" | "pink" | "white";

export type NoiseRandomSource = () => number;

export type CreateNoiseBufferOptions = {
  readonly duration?: number;
  readonly length?: number;
  readonly numberOfChannels?: number;
  readonly random?: NoiseRandomSource;
  readonly sampleRate?: number;
  readonly seed?: number;
  readonly type?: NoiseType;
};

export type NoiseBufferInfo = {
  readonly duration: number;
  readonly length: number;
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  readonly type: NoiseType;
};

export type NoiseOptions = CreateNoiseBufferOptions & {
  readonly fadeIn?: number;
  readonly fadeOut?: number;
  readonly mute?: boolean;
  /**
   * Called once each time playback stops or ends.
   */
  readonly onStop?: (voice: BufferVoice) => void;
  readonly playbackRate?: number;
  readonly volume?: number;
};

export type NoiseStartOptions = {
  readonly time?: number;
  /**
   * Offset into the noise buffer. Defaults to a random position.
   */
  readonly offset?: number;
};

/**
 * Creates an `AudioBuffer` of noise in the color given by `options.type` (white by default). The
 * length comes from `options.length` frames or `options.duration` seconds. Pass `options.seed` or
 * `options.random` for reproducible noise.
 */
export function createNoiseBuffer(
  context: AudioContextLike,
  options: CreateNoiseBufferOptions = {},
): AudioBuffer {
  const nativeContext = getNativeAudioContext(context);
  const sampleRate = requirePositive(options.sampleRate ?? nativeContext.sampleRate, "sampleRate");

  const length = getNoiseBufferLength({
    duration: options.duration,
    length: options.length,
    sampleRate,
  });

  const numberOfChannels = floorPositive(options.numberOfChannels ?? 1, "Noise channel count");

  const random = options.random ?? createNoiseRandom(options.seed);

  const channels = Array.from({ length: numberOfChannels }, () =>
    createNoiseChannel(options.type ?? "white", length, random),
  );

  return createAudioBuffer({
    channels,
    length,
    numberOfChannels,
    sampleRate,
  });
}

/**
 * Returns the format of a noise buffer together with its noise `type`.
 */
export function getNoiseBufferInfo(
  buffer: AudioBuffer,
  type: NoiseType = "white",
): NoiseBufferInfo {
  return {
    duration: buffer.duration,
    length: buffer.length,
    numberOfChannels: buffer.numberOfChannels,
    sampleRate: buffer.sampleRate,
    type,
  };
}

/**
 * Looping noise source whose color can change while it plays.
 */
export class Noise extends OutputUnit {
  readonly #options: NoiseOptions;
  readonly #voices: BufferVoice[] = [];
  #buffer: AudioBuffer;
  #fadeIn: number;
  #fadeOut: number;
  #playbackRate: number;
  #type: NoiseType;

  constructor(context: AudioContextLike, options: NoiseOptions = {}) {
    super(context, options);
    this.#options = options;
    this.#type = options.type ?? "white";
    this.#buffer = createNoiseBuffer(context, options);
    this.#fadeIn = requireNonNegative(options.fadeIn ?? 0, "fadeIn");
    this.#fadeOut = requireNonNegative(options.fadeOut ?? 0, "fadeOut");
    this.#playbackRate = requirePositive(options.playbackRate ?? 1, "playbackRate");
  }

  get fadeIn(): number {
    return this.#fadeIn;
  }

  get fadeOut(): number {
    return this.#fadeOut;
  }

  get playbackRate(): number {
    return this.#playbackRate;
  }

  get source(): AudioBufferSourceNode | undefined {
    return this.#voices[0]?.source;
  }

  get state(): RunState {
    return this.#voices.length > 0 ? "started" : "stopped";
  }

  get type(): NoiseType {
    return this.#type;
  }

  /**
   * Starts the loop. Does nothing while already playing.
   */
  start({ offset, time }: NoiseStartOptions = {}): void {
    if (this.disposed || this.#voices.length > 0) {
      return;
    }

    const voice = new BufferVoice(
      this.context,
      this.#voices,
      {
        buffer: this.#buffer,
        destination: this.output,
        loop: true,
        playbackRate: this.#playbackRate,
      },
      this.#options.onStop,
    );

    this.#voices.push(voice);
    voice.start({
      fadeIn: this.#fadeIn,
      fadeOut: this.#fadeOut,
      offset: offset ?? Math.random() * this.#buffer.duration,
      time: time ?? this.now(),
    });
  }

  stop(time: number = this.now()): void {
    for (const voice of Array.from(this.#voices)) {
      voice.stop(time);
    }
  }

  setFadeIn(fadeIn: number): void {
    this.#fadeIn = requireNonNegative(fadeIn, "fadeIn");
  }

  setFadeOut(fadeOut: number): void {
    this.#fadeOut = requireNonNegative(fadeOut, "fadeOut");
  }

  setPlaybackRate(playbackRate: number, time: number = this.now()): void {
    this.#playbackRate = requirePositive(playbackRate, "playbackRate");
    this.source?.playbackRate.setValueAtTime(this.#playbackRate, time);
  }

  /**
   * Regenerates the buffer with another noise color, restarting playback if it is running.
   */
  setType(type: NoiseType): void {
    this.#type = type;
    this.#buffer = createNoiseBuffer(this.context, { ...this.#options, type });

    if (this.#voices.length > 0) {
      const time = this.now();

      for (const voice of Array.from(this.#voices)) {
        voice.stop(time, 0);
      }

      this.start({ time });
    }
  }

  protected override teardown(): void {
    for (const voice of Array.from(this.#voices)) {
      voice.dispose();
    }
  }
}

/**
 * Fills a new array of `length` samples with noise of `type`, drawing from `random`.
 */
export function createNoiseChannel(
  type: NoiseType,
  length: number,
  random: NoiseRandomSource = Math.random,
): Float32Array {
  const channel = new Float32Array(floorNonNegative(length, "Noise length"));

  switch (type) {
    case "brown": {
      fillBrownNoise(channel, random);

      return channel;
    }

    case "pink": {
      fillPinkNoise(channel, random);

      return channel;
    }

    case "white": {
      fillWhiteNoise(channel, random);

      return channel;
    }
  }
}

/**
 * Returns a seeded pseudo-random generator of numbers in [0, 1). The same seed gives the same
 * sequence.
 */
export function createNoiseRandom(seed: number = Date.now()): NoiseRandomSource {
  let state = seed >>> 0;

  return () => {
    state = (1_664_525 * state + 1_013_904_223) >>> 0;

    return state / 0x1_0000_0000;
  };
}

function fillWhiteNoise(channel: Float32Array, random: NoiseRandomSource): void {
  for (let i = 0; i < channel.length; i++) {
    channel[i] = random() * 2 - 1;
  }
}

function fillBrownNoise(channel: Float32Array, random: NoiseRandomSource): void {
  let lastOut = 0;

  for (let i = 0; i < channel.length; i++) {
    const white = random() * 2 - 1;
    channel[i] = ((lastOut + 0.02 * white) / 1.02) * 3.5;
    lastOut = channel[i]!;
  }
}

function fillPinkNoise(channel: Float32Array, random: NoiseRandomSource): void {
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;

  for (let i = 0; i < channel.length; i++) {
    const white = random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    channel[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
}

function getNoiseBufferLength(options: {
  readonly duration?: number;
  readonly length?: number;
  readonly sampleRate: number;
}): number {
  if (isNumber(options.length)) {
    return floorPositive(options.length, "Noise length");
  }

  if (isNumber(options.duration)) {
    return floorPositive(snapToFrame(options.duration * options.sampleRate), "Noise length");
  }

  return options.sampleRate;
}
