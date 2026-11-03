import type { BlueprintParamsOf, OscillatorBlueprint } from "../graph/blueprint.ts";

import { BLUEPRINT_PARAM_KEYS, Blueprint, oscillator } from "../graph/blueprint.ts";
import { lfo, type LfoBlueprint } from "../signal/lfo.ts";
import { clampNormal, requireNonNegative } from "../validation.ts";

export type AutoPannerOptions = {
  readonly depth?: number;
  /**
   * LFO rate in hertz.
   */
  readonly frequency?: number;
  readonly waveform?: OscillatorType;
};

export type TremoloOptions = AutoPannerOptions;

export type RingModulatorOptions = {
  /**
   * Carrier frequency in hertz.
   */
  readonly frequency?: number;
  readonly waveform?: OscillatorType;
};

/**
 * Stereo panner swept between `-depth` and `depth` by an LFO.
 */
export class AutoPannerBlueprint extends Blueprint<
  "stereoPanner",
  StereoPannerOptions,
  BlueprintParamsOf<"stereoPanner">
> {
  readonly depth: number;
  readonly modulator: LfoBlueprint;

  constructor(options: AutoPannerOptions = {}) {
    super("stereoPanner", { pan: 0 }, BLUEPRINT_PARAM_KEYS.stereoPanner);
    this.depth = clampNormal(options.depth ?? 1, "depth");
    this.modulator = lfo({
      frequency: requireNonNegative(options.frequency ?? 1, "frequency"),
      max: this.depth,
      min: -this.depth,
      type: options.waveform ?? "sine",
    });
    this.modulator.connect(this.params.pan);
  }
}

/**
 * Creates an auto-panner blueprint: a stereo panner whose position an LFO moves.
 */
export function autoPanner(options: AutoPannerOptions = {}): AutoPannerBlueprint {
  return new AutoPannerBlueprint(options);
}

/**
 * Gain swept between `1 - depth` and `1` by an LFO.
 */
export class TremoloBlueprint extends Blueprint<"gain", GainOptions, BlueprintParamsOf<"gain">> {
  readonly depth: number;
  readonly modulator: LfoBlueprint;

  constructor(options: TremoloOptions = {}) {
    // The LFO outputs absolute gain values, so the intrinsic gain is zero.
    super("gain", { gain: 0 }, BLUEPRINT_PARAM_KEYS.gain);
    this.depth = clampNormal(options.depth ?? 0.5, "depth");
    this.modulator = lfo({
      frequency: requireNonNegative(options.frequency ?? 10, "frequency"),
      max: 1,
      min: 1 - this.depth,
      type: options.waveform ?? "sine",
    });
    this.modulator.connect(this.params.gain);
  }
}

/**
 * Creates a tremolo blueprint: a gain that an LFO modulates.
 */
export function tremolo(options: TremoloOptions = {}): TremoloBlueprint {
  return new TremoloBlueprint(options);
}

/**
 * Multiplies the input by an audio-rate carrier oscillator.
 */
export class RingModulatorBlueprint extends Blueprint<
  "gain",
  GainOptions,
  BlueprintParamsOf<"gain">
> {
  readonly carrier: OscillatorBlueprint;
  readonly frequency: number;

  constructor(options: RingModulatorOptions = {}) {
    super("gain", { gain: 0 }, BLUEPRINT_PARAM_KEYS.gain);
    this.frequency = requireNonNegative(options.frequency ?? 30, "frequency");
    this.carrier = oscillator({ frequency: this.frequency, type: options.waveform ?? "sine" });
    this.carrier.connect(this.params.gain);
  }
}

/**
 * Creates a ring modulator blueprint: the input multiplied by an oscillator at `frequency`.
 */
export function ringModulator(options: RingModulatorOptions = {}): RingModulatorBlueprint {
  return new RingModulatorBlueprint(options);
}
