import type { AudioContextLike } from "../context/context.ts";
import type { CompressorOptions } from "./dynamics.ts";

import { createBiquadFilterNode } from "../native.ts";
import { dbToGain } from "../signal/param.ts";
import { AudioNodeUnit, AudioUnitBase } from "../unit.ts";
import { requirePositive } from "../validation.ts";
import { Compressor } from "./dynamics.ts";

export type MultibandSplitOptions = {
  readonly highFrequency?: number;
  readonly lowFrequency?: number;
  readonly Q?: number;
};

export type MultibandCompressorOptions = MultibandSplitOptions & {
  readonly high?: CompressorOptions;
  readonly low?: CompressorOptions;
  readonly mid?: CompressorOptions;
};

export type EQ3Options = MultibandSplitOptions & {
  /**
   * High band gain in decibels.
   */
  readonly high?: number;
  /**
   * Low band gain in decibels.
   */
  readonly low?: number;
  /**
   * Mid band gain in decibels.
   */
  readonly mid?: number;
};

/**
 * Splits the input at two crossover frequencies. `low` carries what is below `lowFrequency` and
 * `high` what is above `highFrequency`; `mid` is the band between them.
 */
export class MultibandSplit extends AudioUnitBase {
  readonly input: GainNode;
  readonly low: BiquadFilterNode;
  readonly mid: BiquadFilterNode;
  readonly high: BiquadFilterNode;
  readonly #lowMid: BiquadFilterNode;

  constructor(context: AudioContextLike, options: MultibandSplitOptions = {}) {
    super(context);
    const lowFrequency = requirePositive(options.lowFrequency ?? 400, "lowFrequency");
    const highFrequency = requirePositive(options.highFrequency ?? 2_500, "highFrequency");
    const Q = requirePositive(options.Q ?? 1, "Q");

    const filter = (type: BiquadFilterType, frequency: number): BiquadFilterNode =>
      this.nodes.add(createBiquadFilterNode(this.native, { frequency, Q, type }));

    this.input = this.createGain();
    this.low = filter("lowpass", lowFrequency);
    this.#lowMid = filter("highpass", lowFrequency);
    this.mid = filter("lowpass", highFrequency);
    this.high = filter("highpass", highFrequency);
    this.input.connect(this.low);
    this.input.connect(this.#lowMid);
    this.input.connect(this.high);
    this.#lowMid.connect(this.mid);
  }

  get lowFrequency(): AudioParam {
    return this.low.frequency;
  }

  get highFrequency(): AudioParam {
    return this.high.frequency;
  }

  get Q(): AudioParam {
    return this.low.Q;
  }

  setLowFrequency(value: number, time: number = this.now()): void {
    const frequency = requirePositive(value, "lowFrequency");
    this.low.frequency.setValueAtTime(frequency, time);
    this.#lowMid.frequency.setValueAtTime(frequency, time);
  }

  setHighFrequency(value: number, time: number = this.now()): void {
    const frequency = requirePositive(value, "highFrequency");
    this.mid.frequency.setValueAtTime(frequency, time);
    this.high.frequency.setValueAtTime(frequency, time);
  }

  setQ(value: number, time: number = this.now()): void {
    const q = requirePositive(value, "Q");

    for (const filter of [this.low, this.#lowMid, this.mid, this.high]) {
      filter.Q.setValueAtTime(q, time);
    }
  }
}

/**
 * Splits the input with `MultibandSplit` and runs each band through its own `Compressor` before
 * summing them.
 */
export class MultibandCompressor extends AudioNodeUnit {
  readonly split: MultibandSplit;
  readonly low: Compressor;
  readonly mid: Compressor;
  readonly high: Compressor;
  readonly output: GainNode;

  constructor(context: AudioContextLike, options: MultibandCompressorOptions = {}) {
    super(context);
    this.split = new MultibandSplit(context, {
      highFrequency: options.highFrequency ?? 2_000,
      lowFrequency: options.lowFrequency ?? 250,
      Q: options.Q,
    });
    this.output = this.createGain();
    this.low = new Compressor(context, {
      attack: 0.03,
      knee: 10,
      ratio: 6,
      release: 0.25,
      threshold: -30,
      ...options.low,
    });
    this.mid = new Compressor(context, {
      attack: 0.02,
      knee: 16,
      ratio: 3,
      release: 0.03,
      threshold: -24,
      ...options.mid,
    });
    this.high = new Compressor(context, {
      attack: 0.02,
      knee: 16,
      ratio: 3,
      release: 0.03,
      threshold: -24,
      ...options.high,
    });
    this.split.low.connect(this.low.input);
    this.split.mid.connect(this.mid.input);
    this.split.high.connect(this.high.input);
    this.low.connect(this.output);
    this.mid.connect(this.output);
    this.high.connect(this.output);
  }

  get input(): GainNode {
    return this.split.input;
  }

  get lowFrequency(): AudioParam {
    return this.split.lowFrequency;
  }

  get highFrequency(): AudioParam {
    return this.split.highFrequency;
  }

  setLowFrequency(value: number, time?: number): void {
    this.split.setLowFrequency(value, time);
  }

  setHighFrequency(value: number, time?: number): void {
    this.split.setHighFrequency(value, time);
  }

  protected override teardown(): void {
    this.split.dispose();
    this.low.dispose();
    this.mid.dispose();
    this.high.dispose();
  }
}

/**
 * Three-band equalizer with gains in decibels.
 */
export class EQ3 extends AudioNodeUnit {
  readonly split: MultibandSplit;
  readonly lowBand: GainNode;
  readonly midBand: GainNode;
  readonly highBand: GainNode;
  readonly output: GainNode;

  constructor(context: AudioContextLike, options: EQ3Options = {}) {
    super(context);
    this.split = new MultibandSplit(context, {
      highFrequency: options.highFrequency ?? 2_500,
      lowFrequency: options.lowFrequency ?? 400,
      Q: options.Q,
    });
    this.lowBand = this.createGain(dbToGain(options.low ?? 0));
    this.midBand = this.createGain(dbToGain(options.mid ?? 0));
    this.highBand = this.createGain(dbToGain(options.high ?? 0));
    this.output = this.createGain();
    this.split.low.connect(this.lowBand);
    this.split.mid.connect(this.midBand);
    this.split.high.connect(this.highBand);
    this.lowBand.connect(this.output);
    this.midBand.connect(this.output);
    this.highBand.connect(this.output);
  }

  get input(): GainNode {
    return this.split.input;
  }

  get low(): AudioParam {
    return this.lowBand.gain;
  }

  get mid(): AudioParam {
    return this.midBand.gain;
  }

  get high(): AudioParam {
    return this.highBand.gain;
  }

  get lowFrequency(): AudioParam {
    return this.split.lowFrequency;
  }

  get highFrequency(): AudioParam {
    return this.split.highFrequency;
  }

  setLow(value: number, time: number = this.now()): void {
    this.lowBand.gain.setValueAtTime(dbToGain(value), time);
  }

  setMid(value: number, time: number = this.now()): void {
    this.midBand.gain.setValueAtTime(dbToGain(value), time);
  }

  setHigh(value: number, time: number = this.now()): void {
    this.highBand.gain.setValueAtTime(dbToGain(value), time);
  }

  setLowFrequency(value: number, time?: number): void {
    this.split.setLowFrequency(value, time);
  }

  setHighFrequency(value: number, time?: number): void {
    this.split.setHighFrequency(value, time);
  }

  protected override teardown(): void {
    this.split.dispose();
  }
}
