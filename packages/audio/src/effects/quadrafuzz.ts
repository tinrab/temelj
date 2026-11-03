/* oxlint-disable anti-slop/no-shape-in-symbol-names -- `WaveShaper` is the Web Audio API name (`WaveShaperNode`, `BaseAudioContext.createWaveShaper()`). */
import type { AudioContextLike } from "../context/context.ts";
import type {
  BiquadFilterBlueprint,
  BlueprintParamsOf,
  GainBlueprint,
  WaveShaperBlueprint,
} from "../graph/blueprint.ts";

import {
  BLUEPRINT_PARAM_KEYS,
  Blueprint,
  biquadFilter,
  gain,
  waveShaper,
} from "../graph/blueprint.ts";
import { createBiquadFilterNode, createWaveShaperNode } from "../native.ts";
import { AudioNodeUnit } from "../unit.ts";
import { clampNormal, requirePositive } from "../validation.ts";
import { createDistortionCurve } from "./waveshaper.ts";

export type QuadrafuzzBandName = "high" | "low" | "midHigh" | "midLow";

export type QuadrafuzzOptions = {
  readonly high?: number;
  readonly highFrequency?: number;
  readonly low?: number;
  readonly lowFrequency?: number;
  readonly midHigh?: number;
  readonly midLow?: number;
  readonly midFrequency?: number;
  readonly mix?: number;
  readonly oversample?: OverSampleType;
  readonly samples?: number;
};

export type QuadrafuzzBlueprintOptions = {
  readonly high?: number;
  readonly highFrequency?: number;
  readonly low?: number;
  readonly lowFrequency?: number;
  readonly midHigh?: number;
  readonly midLow?: number;
  readonly midFrequency?: number;
  readonly oversample?: OverSampleType;
  readonly samples?: number;
};

/**
 * Four-band distortion. Crossover filters at the three `*Frequency` options split the input into
 * bands; each band goes through its own distortion curve before the bands are summed into this
 * blueprint's output gain.
 */
export class QuadrafuzzBlueprint extends Blueprint<"gain", GainOptions, BlueprintParamsOf<"gain">> {
  readonly bands: readonly (BiquadFilterBlueprint | WaveShaperBlueprint)[];
  readonly #input: GainBlueprint;

  constructor(options: QuadrafuzzBlueprintOptions = {}) {
    super("gain", { gain: 1 }, BLUEPRINT_PARAM_KEYS.gain);
    const input = gain({ gain: 1 });
    this.#input = input;
    const lowFrequency = requirePositive(options.lowFrequency ?? 147, "lowFrequency");
    const midFrequency = requirePositive(options.midFrequency ?? 587, "midFrequency");
    const highFrequency = requirePositive(options.highFrequency ?? 2_490, "highFrequency");
    const samples = Math.max(2, Math.floor(requirePositive(options.samples ?? 1024, "samples")));
    const low = biquadFilter({ frequency: lowFrequency, type: "lowpass" });
    const midLowHighpass = biquadFilter({ frequency: lowFrequency, type: "highpass" });
    const midLowLowpass = biquadFilter({ frequency: midFrequency, type: "lowpass" });
    const midHighHighpass = biquadFilter({ frequency: midFrequency, type: "highpass" });
    const midHighLowpass = biquadFilter({ frequency: highFrequency, type: "lowpass" });
    const high = biquadFilter({ frequency: highFrequency, type: "highpass" });

    const lowDistortion = waveShaper({
      curve: createDistortionCurve(options.low ?? 0.6, samples),
      oversample: options.oversample,
    });

    const midLowDistortion = waveShaper({
      curve: createDistortionCurve(options.midLow ?? 0.6, samples),
      oversample: options.oversample,
    });

    const midHighDistortion = waveShaper({
      curve: createDistortionCurve(options.midHigh ?? 0.6, samples),
      oversample: options.oversample,
    });

    const highDistortion = waveShaper({
      curve: createDistortionCurve(options.high ?? 0.6, samples),
      oversample: options.oversample,
    });

    input.connect(low).connect(lowDistortion);
    this.connectFrom(lowDistortion);
    input.connect(midLowHighpass).connect(midLowLowpass).connect(midLowDistortion);
    this.connectFrom(midLowDistortion);
    input.connect(midHighHighpass).connect(midHighLowpass).connect(midHighDistortion);
    this.connectFrom(midHighDistortion);
    input.connect(high).connect(highDistortion);
    this.connectFrom(highDistortion);
    this.bands = [
      low,
      midLowHighpass,
      midLowLowpass,
      midHighHighpass,
      midHighLowpass,
      high,
      lowDistortion,
      midLowDistortion,
      midHighDistortion,
      highDistortion,
    ];
  }

  override get input(): Blueprint {
    return this.#input;
  }
}

/**
 * Creates a four-band distortion blueprint that distorts each band separately before summing them.
 */
export function quadrafuzz(options: QuadrafuzzBlueprintOptions = {}): QuadrafuzzBlueprint {
  return new QuadrafuzzBlueprint(options);
}

type QuadrafuzzBand = {
  readonly filter: BiquadFilterNode;
  readonly output: GainNode;
};

/**
 * Four-band distortion with a dry/wet mix.
 */
export class Quadrafuzz extends AudioNodeUnit {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly #bands: Readonly<Record<QuadrafuzzBandName, QuadrafuzzBand>>;
  readonly #midLowCeiling: BiquadFilterNode;
  readonly #midHighCeiling: BiquadFilterNode;
  readonly #dry: GainNode;
  readonly #wet: GainNode;
  #mix: number;

  constructor(context: AudioContextLike, options: QuadrafuzzOptions = {}) {
    super(context);
    const lowFrequency = requirePositive(options.lowFrequency ?? 147, "lowFrequency");
    const midFrequency = requirePositive(options.midFrequency ?? 587, "midFrequency");
    const highFrequency = requirePositive(options.highFrequency ?? 2_490, "highFrequency");
    const samples = Math.max(2, Math.floor(requirePositive(options.samples ?? 1024, "samples")));

    const filter = (frequency: number, type: BiquadFilterType): BiquadFilterNode =>
      this.nodes.add(createBiquadFilterNode(this.native, { frequency, type }));

    const band = (drive: number, frequency: number, type: BiquadFilterType): QuadrafuzzBand => {
      const bandFilter = filter(frequency, type);

      const distortion = this.nodes.add(
        createWaveShaperNode(this.native, {
          curve: createDistortionCurve(drive, samples),
          oversample: options.oversample,
        }),
      );

      const output = this.createGain(clampNormal(drive, "drive"));
      bandFilter.connect(distortion).connect(output);

      return { filter: bandFilter, output };
    };

    this.#mix = clampNormal(options.mix ?? 1, "mix");
    this.input = this.createGain();
    this.output = this.createGain();
    this.#dry = this.createGain(1 - this.#mix);
    this.#wet = this.createGain(this.#mix);
    this.#bands = {
      high: band(options.high ?? 0.6, highFrequency, "highpass"),
      low: band(options.low ?? 0.6, lowFrequency, "lowpass"),
      midHigh: band(options.midHigh ?? 0.6, midFrequency, "highpass"),
      midLow: band(options.midLow ?? 0.6, lowFrequency, "highpass"),
    };
    this.#midLowCeiling = filter(midFrequency, "lowpass");
    this.#midHighCeiling = filter(highFrequency, "lowpass");

    this.input.connect(this.#dry).connect(this.output);

    for (const { filter: bandFilter } of Object.values(this.#bands)) {
      this.input.connect(bandFilter);
    }

    this.#bands.low.output.connect(this.#wet);
    this.#bands.midLow.output.connect(this.#midLowCeiling).connect(this.#wet);
    this.#bands.midHigh.output.connect(this.#midHighCeiling).connect(this.#wet);
    this.#bands.high.output.connect(this.#wet);
    this.#wet.connect(this.output);
  }

  get lowFrequency(): AudioParam {
    return this.#bands.low.filter.frequency;
  }

  get midFrequency(): AudioParam {
    return this.#bands.midHigh.filter.frequency;
  }

  get highFrequency(): AudioParam {
    return this.#bands.high.filter.frequency;
  }

  get mix(): number {
    return this.#mix;
  }

  /**
   * Output gain of one band.
   */
  bandGain(band: QuadrafuzzBandName): AudioParam {
    return this.#bands[band].output.gain;
  }

  setBandGain(band: QuadrafuzzBandName, value: number, time: number = this.now()): void {
    this.bandGain(band).setValueAtTime(clampNormal(value, "gain"), time);
  }

  setLowFrequency(value: number, time: number = this.now()): void {
    const frequency = requirePositive(value, "lowFrequency");
    this.#bands.low.filter.frequency.setValueAtTime(frequency, time);
    this.#bands.midLow.filter.frequency.setValueAtTime(frequency, time);
  }

  setMidFrequency(value: number, time: number = this.now()): void {
    const frequency = requirePositive(value, "midFrequency");
    this.#midLowCeiling.frequency.setValueAtTime(frequency, time);
    this.#bands.midHigh.filter.frequency.setValueAtTime(frequency, time);
  }

  setHighFrequency(value: number, time: number = this.now()): void {
    const frequency = requirePositive(value, "highFrequency");
    this.#midHighCeiling.frequency.setValueAtTime(frequency, time);
    this.#bands.high.filter.frequency.setValueAtTime(frequency, time);
  }

  setMix(value: number, time: number = this.now()): void {
    this.#mix = clampNormal(value, "mix");
    this.#dry.gain.setValueAtTime(1 - this.#mix, time);
    this.#wet.gain.setValueAtTime(this.#mix, time);
  }
}
