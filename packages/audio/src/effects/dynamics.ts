import type { AudioContextLike } from "../context/context.ts";

import { getPeak, getRms } from "../analyser.ts";
import { createAnalyserNode, createDynamicsCompressorNode } from "../native.ts";
import { gainToDb } from "../signal/param.ts";
import { AudioNodeUnit } from "../unit.ts";
import { requireFinite, requireNonNegative, requirePositive } from "../validation.ts";
import { MidSideMerge, MidSideSplit } from "./channel.ts";

export type CompressorOptions = {
  readonly attack?: number;
  readonly knee?: number;
  readonly ratio?: number;
  readonly release?: number;
  readonly threshold?: number;
};

export type LimiterOptions = {
  readonly threshold?: number;
};

export type MidSideCompressorOptions = {
  readonly mid?: CompressorOptions;
  readonly side?: CompressorOptions;
};

export type GateOptions = {
  /**
   * Open time constant in seconds.
   */
  readonly attack?: number;
  /**
   * Close time constant in seconds.
   */
  readonly release?: number;
  /**
   * Level in decibels at or above which the gate opens. Below it, the gate closes.
   */
  readonly threshold?: number;
  /**
   * Detect peaks instead of RMS level.
   */
  readonly usePeak?: boolean;
};

const COMPRESSOR_DEFAULTS: Required<CompressorOptions> = {
  attack: 0.003,
  knee: 30,
  ratio: 12,
  release: 0.25,
  threshold: -24,
};

/**
 * `DynamicsCompressorNode` with validated setters.
 */
export class Compressor extends AudioNodeUnit {
  readonly compressor: DynamicsCompressorNode;

  constructor(context: AudioContextLike, options: CompressorOptions = {}) {
    super(context);
    const settings = { ...COMPRESSOR_DEFAULTS, ...options };
    const time = this.now();
    this.compressor = this.nodes.add(createDynamicsCompressorNode(this.native));
    this.compressor.attack.setValueAtTime(settings.attack, time);
    this.compressor.knee.setValueAtTime(settings.knee, time);
    this.compressor.ratio.setValueAtTime(settings.ratio, time);
    this.compressor.release.setValueAtTime(settings.release, time);
    this.compressor.threshold.setValueAtTime(settings.threshold, time);
  }

  get input(): DynamicsCompressorNode {
    return this.compressor;
  }

  get output(): DynamicsCompressorNode {
    return this.compressor;
  }

  get attack(): AudioParam {
    return this.compressor.attack;
  }

  get knee(): AudioParam {
    return this.compressor.knee;
  }

  get ratio(): AudioParam {
    return this.compressor.ratio;
  }

  get release(): AudioParam {
    return this.compressor.release;
  }

  get threshold(): AudioParam {
    return this.compressor.threshold;
  }

  /**
   * Current gain reduction in decibels.
   */
  get reduction(): number {
    return this.compressor.reduction;
  }

  setAttack(value: number, time: number = this.now()): void {
    this.compressor.attack.setValueAtTime(requireNonNegative(value, "attack"), time);
  }

  setKnee(value: number, time: number = this.now()): void {
    this.compressor.knee.setValueAtTime(requireNonNegative(value, "knee"), time);
  }

  setRatio(value: number, time: number = this.now()): void {
    this.compressor.ratio.setValueAtTime(requirePositive(value, "ratio"), time);
  }

  setRelease(value: number, time: number = this.now()): void {
    this.compressor.release.setValueAtTime(requireNonNegative(value, "release"), time);
  }

  setThreshold(value: number, time: number = this.now()): void {
    this.compressor.threshold.setValueAtTime(requireFinite(value, "threshold"), time);
  }
}

/**
 * Compressor used as a limiter: a hard knee and a 20:1 ratio above `threshold` (-12 dB by default).
 * Attack is 3 ms and release is 10 ms.
 */
export class Limiter extends Compressor {
  constructor(context: AudioContextLike, options: LimiterOptions = {}) {
    super(context, {
      attack: 0.003,
      knee: 0,
      ratio: 20,
      release: 0.01,
      threshold: options.threshold ?? -12,
    });
  }
}

/**
 * Compresses the mid and side parts of a stereo signal independently.
 */
export class MidSideCompressor extends AudioNodeUnit {
  readonly mid: Compressor;
  readonly side: Compressor;
  readonly midSideSplit: MidSideSplit;
  readonly midSideMerge: MidSideMerge;

  constructor(context: AudioContextLike, options: MidSideCompressorOptions = {}) {
    super(context);
    this.midSideSplit = new MidSideSplit(context);
    this.midSideMerge = new MidSideMerge(context);
    this.mid = new Compressor(context, {
      attack: 0.02,
      knee: 16,
      ratio: 3,
      release: 0.03,
      threshold: -24,
      ...options.mid,
    });
    this.side = new Compressor(context, {
      attack: 0.03,
      knee: 10,
      ratio: 6,
      release: 0.25,
      threshold: -30,
      ...options.side,
    });
    this.midSideSplit.mid.connect(this.mid.input);
    this.mid.connect(this.midSideMerge.mid);
    this.midSideSplit.side.connect(this.side.input);
    this.side.connect(this.midSideMerge.side);
  }

  get input(): ChannelSplitterNode {
    return this.midSideSplit.input;
  }

  get output(): ChannelMergerNode {
    return this.midSideMerge.output;
  }

  protected override teardown(): void {
    this.midSideSplit.dispose();
    this.mid.dispose();
    this.side.dispose();
    this.midSideMerge.dispose();
  }
}

/**
 * Analyser-driven noise gate. Call `update()` periodically to follow the input level.
 */
export class Gate extends AudioNodeUnit {
  readonly analyser: AnalyserNode;
  readonly gate: GainNode;
  readonly input: GainNode;
  readonly #data: Float32Array<ArrayBuffer>;
  readonly #options: GateOptions;
  #open = false;
  #threshold: number;

  constructor(context: AudioContextLike, options: GateOptions = {}) {
    super(context);
    this.#options = options;
    this.#threshold = options.threshold ?? -40;
    this.input = this.createGain();
    this.gate = this.createGain(0);
    this.analyser = this.nodes.add(createAnalyserNode(this.native));
    this.#data = new Float32Array(this.analyser.fftSize);
    this.input.connect(this.gate);
    this.input.connect(this.analyser);
  }

  get output(): GainNode {
    return this.gate;
  }

  get open(): boolean {
    return this.#open;
  }

  get threshold(): number {
    return this.#threshold;
  }

  setThreshold(value: number): void {
    this.#threshold = value;
  }

  /**
   * Reads the input level and opens or closes the gate. Returns whether it is open.
   */
  update(time: number = this.now()): boolean {
    const levelOptions = { target: this.#data };

    const level =
      this.#options.usePeak === true
        ? getPeak(this.analyser, levelOptions)
        : getRms(this.analyser, levelOptions);

    const open = gainToDb(level) >= this.#threshold;

    if (open !== this.#open) {
      this.#open = open;
      const timeConstant = open ? (this.#options.attack ?? 0.005) : (this.#options.release ?? 0.1);
      this.gate.gain.setTargetAtTime(open ? 1 : 0, time, Math.max(0.001, timeConstant));
    }

    return open;
  }
}
