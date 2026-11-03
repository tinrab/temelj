import type { AudioContextLike } from "../context/context.ts";

import { EnvelopeFollower } from "../analyser.ts";
import { createAnalyserNode, createBiquadFilterNode } from "../native.ts";
import { dbToGain } from "../signal/param.ts";
import { AudioNodeUnit } from "../unit.ts";
import { clampNormal, requireFinite, requireNonNegative, requirePositive } from "../validation.ts";

export type AutoWahOptions = {
  readonly baseFrequency?: number;
  readonly follower?: number;
  readonly gain?: number;
  readonly octaves?: number;
  readonly Q?: number;
  readonly sensitivity?: number;
  readonly usePeak?: boolean;
};

/**
 * Band-pass plus peaking filter whose frequency follows the input level. Call `update()`
 * periodically to move the sweep.
 */
export class AutoWah extends AudioNodeUnit {
  readonly input: GainNode;
  readonly analyser: AnalyserNode;
  readonly bandpass: BiquadFilterNode;
  readonly peaking: BiquadFilterNode;
  readonly follower: EnvelopeFollower;
  readonly #inputBoost: GainNode;
  #baseFrequency: number;
  #octaves: number;
  #sensitivity: number;

  constructor(context: AudioContextLike, options: AutoWahOptions = {}) {
    super(context);
    this.#baseFrequency = requireNonNegative(options.baseFrequency ?? 100, "baseFrequency");
    this.#octaves = requireNonNegative(options.octaves ?? 6, "octaves");
    this.#sensitivity = requireFinite(options.sensitivity ?? 0, "sensitivity");
    this.input = this.createGain();
    this.#inputBoost = this.createGain(sensitivityToInputGain(this.#sensitivity));
    this.analyser = this.nodes.add(createAnalyserNode(this.native));
    this.bandpass = this.nodes.add(
      createBiquadFilterNode(this.native, {
        Q: requireNonNegative(options.Q ?? 2, "Q"),
        frequency: this.#baseFrequency,
        type: "bandpass",
      }),
    );
    this.peaking = this.nodes.add(
      createBiquadFilterNode(this.native, {
        frequency: this.#baseFrequency,
        gain: options.gain ?? 2,
        type: "peaking",
      }),
    );
    this.follower = new EnvelopeFollower(this.analyser, {
      smoothing: requirePositive(options.follower ?? 0.2, "follower"),
      usePeak: options.usePeak,
    });
    this.input.connect(this.bandpass).connect(this.peaking);
    this.input.connect(this.#inputBoost).connect(this.analyser);
  }

  get output(): BiquadFilterNode {
    return this.peaking;
  }

  get baseFrequency(): number {
    return this.#baseFrequency;
  }

  get octaves(): number {
    return this.#octaves;
  }

  get sensitivity(): number {
    return this.#sensitivity;
  }

  get gain(): AudioParam {
    return this.peaking.gain;
  }

  get Q(): AudioParam {
    return this.bandpass.Q;
  }

  /**
   * Top of the sweep: `octaves` above the base frequency, capped at Nyquist.
   */
  get sweepMaxFrequency(): number {
    return Math.min(this.#baseFrequency * 2 ** this.#octaves, this.native.sampleRate / 2);
  }

  setBaseFrequency(value: number, time: number = this.now()): void {
    this.#baseFrequency = requireNonNegative(value, "baseFrequency");
    this.#setSweepFrequency(this.#baseFrequency, time);
  }

  setGain(value: number, time: number = this.now()): void {
    this.peaking.gain.setValueAtTime(requireFinite(value, "gain"), time);
  }

  setOctaves(value: number, time: number = this.now()): void {
    this.#octaves = requireNonNegative(value, "octaves");
    this.#setSweepFrequency(this.#baseFrequency, time);
  }

  setQ(value: number, time: number = this.now()): void {
    this.bandpass.Q.setValueAtTime(requireNonNegative(value, "Q"), time);
  }

  /**
   * Input sensitivity in decibels; lower values boost the detector.
   */
  setSensitivity(value: number): void {
    this.#sensitivity = requireFinite(value, "sensitivity");
    this.#inputBoost.gain.value = sensitivityToInputGain(this.#sensitivity);
  }

  /**
   * Reads the input level and moves the sweep. Returns the new frequency.
   */
  update(time: number = this.now()): number {
    const level = Math.sqrt(clampNormal(this.follower.update(), "level"));
    const frequency = this.#baseFrequency + (this.sweepMaxFrequency - this.#baseFrequency) * level;
    this.#setSweepFrequency(frequency, time);

    return frequency;
  }

  #setSweepFrequency(frequency: number, time: number): void {
    this.bandpass.frequency.setValueAtTime(frequency, time);
    this.peaking.frequency.setValueAtTime(frequency, time);
  }
}

function sensitivityToInputGain(sensitivity: number): number {
  return 1 / dbToGain(sensitivity);
}
