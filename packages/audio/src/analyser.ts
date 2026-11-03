/* oxlint-disable anti-slop/no-shape-in-symbol-names -- `WaveShaper` is the Web Audio API name (`WaveShaperNode`, `BaseAudioContext.createWaveShaper()`). */
import type { AudioContextLike } from "./context/context.ts";

import { OnePoleFilter } from "./effects/filter.ts";
import { createAnalyserNode, createWaveShaperNode } from "./native.ts";
import { gainToDb } from "./signal/param.ts";
import { AudioNodeUnit } from "./unit.ts";
import { clampNormal, requireInRange, requireInteger, requirePositive } from "./validation.ts";

export type FrequencyDataOptions = {
  readonly target?: Uint8Array<ArrayBuffer>;
};

export type TimeDataOptions = {
  readonly target?: Uint8Array<ArrayBuffer>;
};

export type WaveformDataOptions = {
  readonly target?: Float32Array<ArrayBuffer>;
};

export type LevelOptions = WaveformDataOptions;

export type EnvelopeFollowerOptions = LevelOptions & {
  readonly initialValue?: number;
  readonly sampleRate?: number;
  readonly smoothing?: number;
  readonly usePeak?: boolean;
};

export type FollowerOptions = {
  readonly curveLength?: number;
  readonly smoothing?: number;
};

export type FftAnalyserOptions = AnalyserOptions & {
  readonly size?: number;
};

export type WaveformAnalyserOptions = AnalyserOptions & {
  readonly size?: number;
};

export type MeterOptions = AnalyserOptions & {
  readonly size?: number;
  readonly smoothing?: number;
  readonly usePeak?: boolean;
};

export type DcMeterOptions = AnalyserOptions & {
  readonly size?: number;
};

/**
 * Reads the analyser's current byte frequency spectrum (0–255 per bin). Pass `options.target` to
 * reuse an array of `frequencyBinCount` bytes.
 */
export function getFrequencyData(
  analyser: AnalyserNode,
  options: FrequencyDataOptions = {},
): Uint8Array<ArrayBuffer> {
  const target = options.target ?? new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(target);

  return target;
}

/**
 * Reads the analyser's current byte waveform (128 is silence). Pass `options.target` to reuse an
 * array of `fftSize` bytes.
 */
export function getTimeData(
  analyser: AnalyserNode,
  options: TimeDataOptions = {},
): Uint8Array<ArrayBuffer> {
  const target = options.target ?? new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(target);

  return target;
}

/**
 * Reads the analyser's current waveform as float samples. They are not clamped, so loud input can
 * exceed -1 to 1. Pass `options.target` to reuse an array of `fftSize` samples.
 */
export function getWaveformData(
  analyser: AnalyserNode,
  options: WaveformDataOptions = {},
): Float32Array<ArrayBuffer> {
  const target = options.target ?? new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(target);

  return target;
}

/**
 * Returns the mean of the analyser's byte frequency bins (0–255), or 0 when it has none.
 */
export function getAverageFrequency(analyser: AnalyserNode): number {
  const data = getFrequencyData(analyser);

  if (data.length === 0) {
    return 0;
  }

  let total = 0;

  for (let i = 0; i < data.length; i++) {
    total += data[i] ?? 0;
  }

  return total / data.length;
}

/**
 * Returns the root mean square level of the analyser's current waveform, in linear amplitude.
 */
export function getRms(analyser: AnalyserNode, options: LevelOptions = {}): number {
  const data = getWaveformData(analyser, options);

  if (data.length === 0) {
    return 0;
  }

  let sum = 0;

  for (let i = 0; i < data.length; i++) {
    const sample = data[i] ?? 0;
    sum += sample * sample;
  }

  return Math.sqrt(sum / data.length);
}

/**
 * Returns the largest absolute sample in the analyser's current waveform, in linear amplitude.
 */
export function getPeak(analyser: AnalyserNode, options: LevelOptions = {}): number {
  const data = getWaveformData(analyser, options);
  let peak = 0;

  for (let i = 0; i < data.length; i++) {
    peak = Math.max(peak, Math.abs(data[i] ?? 0));
  }

  return peak;
}

/**
 * Returns `getRms()` in decibels relative to full scale.
 */
export function getRmsDb(analyser: AnalyserNode, options: LevelOptions = {}): number {
  return gainToDb(getRms(analyser, options));
}

/**
 * Returns `getPeak()` in decibels relative to full scale.
 */
export function getPeakDb(analyser: AnalyserNode, options: LevelOptions = {}): number {
  return gainToDb(getPeak(analyser, options));
}

/**
 * Smooths analyser level readings over time with a one-pole follower. Call `update()` at a steady
 * rate: `options.sampleRate` is that rate in calls per second (60 by default), and
 * `options.smoothing` is the time constant in seconds (0.05 by default).
 */
export class EnvelopeFollower {
  readonly analyser: AnalyserNode;
  readonly #coefficient: number;
  readonly #target: Float32Array<ArrayBuffer> | undefined;
  readonly #usePeak: boolean;
  #value: number;

  constructor(analyser: AnalyserNode, options: EnvelopeFollowerOptions = {}) {
    const smoothing = requirePositive(options.smoothing ?? 0.05, "smoothing");
    const sampleRate = requirePositive(options.sampleRate ?? 60, "sampleRate");
    this.analyser = analyser;
    this.#coefficient = Math.exp(-1 / (smoothing * sampleRate));
    this.#target = options.target;
    this.#usePeak = options.usePeak === true;
    this.#value = clampLevel(options.initialValue ?? 0);
  }

  get value(): number {
    return this.#value;
  }

  reset(value = 0): void {
    this.#value = clampLevel(value);
  }

  update(options: LevelOptions = {}): number {
    const levelOptions = { target: options.target ?? this.#target };

    const next = this.#usePeak
      ? getPeak(this.analyser, levelOptions)
      : getRms(this.analyser, levelOptions);

    this.#value = this.#value * this.#coefficient + next * (1 - this.#coefficient);

    return this.#value;
  }
}

/**
 * Audio-rate envelope follower: full-wave rectifier into a one-pole low-pass.
 */
export class Follower extends AudioNodeUnit {
  readonly input: WaveShaperNode;
  readonly filter: OnePoleFilter;
  #smoothing: number;

  constructor(context: AudioContextLike, options: FollowerOptions = {}) {
    super(context);
    this.#smoothing = requirePositive(options.smoothing ?? 0.05, "smoothing");
    this.input = this.nodes.add(
      createWaveShaperNode(this.native, { curve: createAbsCurve(options.curveLength ?? 8_192) }),
    );
    this.filter = new OnePoleFilter(context, { frequency: 1 / this.#smoothing, type: "lowpass" });
    this.input.connect(this.filter.input);
  }

  get output(): GainNode {
    return this.filter.output;
  }

  get smoothing(): number {
    return this.#smoothing;
  }

  setSmoothing(smoothing: number): void {
    this.#smoothing = requirePositive(smoothing, "smoothing");
    this.filter.setFrequency(1 / this.#smoothing);
  }

  protected override teardown(): void {
    this.filter.dispose();
  }
}

/**
 * Pass-through unit around one `AnalyserNode`.
 */
abstract class AnalyserUnit extends AudioNodeUnit {
  readonly analyser: AnalyserNode;

  constructor(context: AudioContextLike, options: AnalyserOptions, size: number) {
    super(context);
    this.analyser = this.nodes.add(createAnalyserNode(this.native));
    applyAnalyserOptions(this.analyser, options);
    this.analyser.fftSize = clampFftSize(size);
  }

  get input(): AnalyserNode {
    return this.analyser;
  }

  get output(): AnalyserNode {
    return this.analyser;
  }
}

/**
 * Frequency-domain analyser.
 */
export class FftAnalyser extends AnalyserUnit {
  constructor(context: AudioContextLike, options: FftAnalyserOptions = {}) {
    super(context, options, options.size ?? options.fftSize ?? 1024);
  }

  /**
   * Number of frequency bins.
   */
  get size(): number {
    return this.analyser.frequencyBinCount;
  }

  getFrequencyOfIndex(index: number): number {
    requireInRange(requireInteger(index, "index"), 0, this.analyser.frequencyBinCount - 1, "index");

    return (index * this.native.sampleRate) / this.analyser.fftSize;
  }

  /**
   * Byte magnitudes in [0, 255].
   */
  getBytes(target?: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
    return getFrequencyData(this.analyser, { target });
  }

  /**
   * Magnitudes scaled to [0, 1].
   */
  getNormalized(target?: Float32Array<ArrayBuffer>): Float32Array<ArrayBuffer> {
    const bytes = getFrequencyData(this.analyser);
    const data = target ?? new Float32Array(bytes.length);

    for (let i = 0; i < data.length; i++) {
      data[i] = (bytes[i] ?? 0) / 255;
    }

    return data;
  }
}

/**
 * Time-domain analyser.
 */
export class WaveformAnalyser extends AnalyserUnit {
  constructor(context: AudioContextLike, options: WaveformAnalyserOptions = {}) {
    super(context, options, options.size ?? options.fftSize ?? 1024);
  }

  get size(): number {
    return this.analyser.fftSize;
  }

  getValue(target?: Float32Array<ArrayBuffer>): Float32Array<ArrayBuffer> {
    return getWaveformData(this.analyser, { target });
  }
}

/**
 * RMS or peak level meter with optional smoothing.
 */
export class Meter extends AnalyserUnit {
  readonly #target: Float32Array<ArrayBuffer>;
  readonly #follower: EnvelopeFollower | undefined;
  readonly #usePeak: boolean;
  #value = 0;

  constructor(context: AudioContextLike, options: MeterOptions = {}) {
    super(context, options, options.size ?? options.fftSize ?? 256);
    this.#target = new Float32Array(this.analyser.fftSize);
    this.#usePeak = options.usePeak === true;
    this.#follower =
      options.smoothing === undefined
        ? undefined
        : new EnvelopeFollower(this.analyser, {
            sampleRate: this.native.sampleRate / this.analyser.fftSize,
            smoothing: options.smoothing,
            target: this.#target,
            usePeak: options.usePeak,
          });
  }

  /**
   * Last level read by `getLevel()`, linear.
   */
  get value(): number {
    return this.#value;
  }

  getPeak(): number {
    return getPeak(this.analyser, { target: this.#target });
  }

  getRms(): number {
    return getRms(this.analyser, { target: this.#target });
  }

  /**
   * Reads the level as linear amplitude, smoothed when `options.smoothing` was given.
   */
  getLevel(): number {
    this.#value = this.#follower?.update() ?? (this.#usePeak ? this.getPeak() : this.getRms());

    return this.#value;
  }

  getLevelDb(): number {
    return gainToDb(this.getLevel());
  }

  reset(value = 0): void {
    this.#value = clampLevel(value);
    this.#follower?.reset(this.#value);
  }
}

/**
 * Meter for slow or constant signals. `getValue()` returns the first sample of the current waveform
 * block.
 */
export class DcMeter extends AnalyserUnit {
  readonly #target: Float32Array<ArrayBuffer>;

  constructor(context: AudioContextLike, options: DcMeterOptions = {}) {
    super(context, options, options.size ?? options.fftSize ?? 256);
    this.#target = new Float32Array(this.analyser.fftSize);
  }

  getValue(): number {
    this.analyser.getFloatTimeDomainData(this.#target);

    return this.#target[0] ?? 0;
  }
}

function applyAnalyserOptions(analyser: AnalyserNode, options: AnalyserOptions): void {
  if (options.minDecibels !== undefined) {
    analyser.minDecibels = options.minDecibels;
  }

  if (options.maxDecibels !== undefined) {
    analyser.maxDecibels = options.maxDecibels;
  }

  if (options.smoothingTimeConstant !== undefined) {
    analyser.smoothingTimeConstant = clampNormal(
      options.smoothingTimeConstant,
      "smoothingTimeConstant",
    );
  }
}

function createAbsCurve(length: number): Float32Array<ArrayBuffer> {
  const normalizedLength = Math.max(2, Math.trunc(length));
  const curve = new Float32Array(normalizedLength);
  const denominator = normalizedLength - 1;

  for (let i = 0; i < normalizedLength; i++) {
    const value = (i / denominator) * 2 - 1;
    curve[i] = Math.abs(value);
  }

  return curve;
}

function clampLevel(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, value);
}

const MIN_FFT_SIZE = 32;

const MAX_FFT_SIZE = 32_768;

/**
 * Rounds to the nearest power of two accepted by `AnalyserNode.fftSize`.
 */
function clampFftSize(value: number): number {
  const exponent = Math.round(Math.log2(requirePositive(value, "fftSize")));

  return Math.min(MAX_FFT_SIZE, Math.max(MIN_FFT_SIZE, 2 ** exponent));
}
