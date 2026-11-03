import type {
  BiquadFilterBlueprint,
  BlueprintParamsOf,
  GainBlueprint,
} from "../graph/blueprint.ts";

import { BLUEPRINT_PARAM_KEYS, Blueprint, biquadFilter, gain } from "../graph/blueprint.ts";
import { lfo, type LfoBlueprint } from "../signal/lfo.ts";
import { clampNormal, requireNonNegative, requirePositiveInteger } from "../validation.ts";

export type ModulatedDelayOptions = {
  /**
   * Center delay time in seconds.
   */
  readonly delayTime?: number;
  /**
   * Modulation depth as a fraction of `delayTime`.
   */
  readonly depth?: number;
  readonly feedback?: number;
  /**
   * LFO rate in hertz.
   */
  readonly frequency?: number;
  readonly maxDelayTime?: number;
  readonly waveform?: OscillatorType;
};

type ModulatedDelayDefaults = {
  readonly delayTime: number;
  readonly depth: number;
  readonly feedback: number;
  readonly frequency: number;
};

const MIN_MAX_DELAY_TIME = 0.03;

/**
 * Delay line whose delay time an LFO sweeps, with optional feedback. Preset factories such as
 * `chorus()` return one with their own defaults, which `options` override.
 */
export class ModulatedDelayBlueprint extends Blueprint<
  "delay",
  DelayOptions,
  BlueprintParamsOf<"delay">
> {
  readonly depth: number;
  readonly feedback: GainBlueprint;
  readonly modulator: LfoBlueprint;

  constructor(options: ModulatedDelayOptions, defaults: ModulatedDelayDefaults) {
    const delayTime = requireNonNegative(options.delayTime ?? defaults.delayTime, "delayTime");
    const depth = clampNormal(options.depth ?? defaults.depth, "depth");
    const sweep = depth * delayTime;
    // The LFO outputs absolute delay times, so the intrinsic delay time is zero.
    super(
      "delay",
      {
        delayTime: 0,
        maxDelayTime: options.maxDelayTime ?? Math.max(MIN_MAX_DELAY_TIME, delayTime + sweep),
      },
      BLUEPRINT_PARAM_KEYS.delay,
    );
    this.depth = depth;
    this.feedback = gain({ gain: clampNormal(options.feedback ?? defaults.feedback, "feedback") });
    this.modulator = lfo({
      frequency: requireNonNegative(options.frequency ?? defaults.frequency, "frequency"),
      max: delayTime + sweep,
      min: Math.max(0, delayTime - sweep),
      type: options.waveform ?? "sine",
    });
    this.connect(this.feedback);
    this.feedback.connect(this);
    this.modulator.connect(this.params.delayTime);
  }
}

/**
 * Creates a chorus blueprint: a short delay whose time an LFO modulates. The output is fully wet;
 * the chorus effect comes from mixing it with the dry signal.
 */
export function chorus(options: ModulatedDelayOptions = {}): ModulatedDelayBlueprint {
  return new ModulatedDelayBlueprint(options, {
    delayTime: 0.0035,
    depth: 0.7,
    feedback: 0,
    frequency: 1.5,
  });
}

/**
 * Creates a flanger blueprint: a 5 ms delay with 0.1 feedback, swept by a 0.25 Hz LFO by default.
 */
export function flanger(options: ModulatedDelayOptions = {}): ModulatedDelayBlueprint {
  return new ModulatedDelayBlueprint(options, {
    delayTime: 0.005,
    depth: 0.5,
    feedback: 0.1,
    frequency: 0.25,
  });
}

/**
 * Creates a vibrato blueprint: a fully wet 3 ms delay modulated at 5 Hz by default, so the pitch
 * rises and falls.
 */
export function vibrato(
  options: Omit<ModulatedDelayOptions, "feedback"> = {},
): ModulatedDelayBlueprint {
  return new ModulatedDelayBlueprint(
    { ...options, feedback: 0 },
    { delayTime: 0.003, depth: 0.1, feedback: 0, frequency: 5 },
  );
}

export type FilterSweepOptions = {
  /**
   * Lowest filter frequency in hertz.
   */
  readonly baseFrequency?: number;
  readonly depth?: number;
  /**
   * LFO rate in hertz.
   */
  readonly frequency?: number;
  /**
   * Sweep range above `baseFrequency`, in octaves.
   */
  readonly octaves?: number;
  readonly waveform?: OscillatorType;
};

export type AutoFilterOptions = FilterSweepOptions & {
  readonly filter?: BiquadFilterOptions;
};

export type PhaserOptions = FilterSweepOptions & {
  readonly Q?: number;
  readonly stages?: number;
};

type FilterSweepDefaults = {
  readonly baseFrequency: number;
  readonly frequency: number;
  readonly octaves: number;
};

type FilterSweep = {
  readonly baseFrequency: number;
  readonly depth: number;
  readonly octaves: number;
  readonly modulator: LfoBlueprint;
};

function createFilterSweep(
  options: FilterSweepOptions,
  defaults: FilterSweepDefaults,
): FilterSweep {
  const baseFrequency = requireNonNegative(
    options.baseFrequency ?? defaults.baseFrequency,
    "baseFrequency",
  );

  const depth = clampNormal(options.depth ?? 1, "depth");
  const octaves = requireNonNegative(options.octaves ?? defaults.octaves, "octaves");

  const modulator = lfo({
    frequency: requireNonNegative(options.frequency ?? defaults.frequency, "frequency"),
    max: baseFrequency * (1 + (2 ** octaves - 1) * depth),
    min: baseFrequency,
    type: options.waveform ?? "sine",
  });

  return { baseFrequency, depth, modulator, octaves };
}

/**
 * Filter whose cutoff is swept by an LFO between `baseFrequency` and `octaves` above it.
 */
export class AutoFilterBlueprint extends Blueprint<
  "biquadFilter",
  BiquadFilterOptions,
  BlueprintParamsOf<"biquadFilter">
> {
  readonly baseFrequency: number;
  readonly depth: number;
  readonly modulator: LfoBlueprint;
  readonly octaves: number;

  constructor(options: AutoFilterOptions = {}) {
    const sweep = createFilterSweep(options, { baseFrequency: 200, frequency: 1, octaves: 2.6 });
    // The LFO outputs absolute frequencies, so the intrinsic frequency is zero.
    super(
      "biquadFilter",
      { Q: 1, type: "lowpass", ...options.filter, frequency: 0 },
      BLUEPRINT_PARAM_KEYS.biquadFilter,
    );
    this.baseFrequency = sweep.baseFrequency;
    this.depth = sweep.depth;
    this.modulator = sweep.modulator;
    this.octaves = sweep.octaves;
    this.modulator.connect(this.params.frequency);
  }
}

/**
 * Creates an auto-filter blueprint: a filter whose cutoff an LFO sweeps.
 */
export function autoFilter(options: AutoFilterOptions = {}): AutoFilterBlueprint {
  return new AutoFilterBlueprint(options);
}

/**
 * Series of all-pass filters swept by one LFO. Signal enters the first stage and leaves through
 * this blueprint's output gain.
 */
export class PhaserBlueprint extends Blueprint<"gain", GainOptions, BlueprintParamsOf<"gain">> {
  readonly baseFrequency: number;
  readonly depth: number;
  readonly filters: readonly BiquadFilterBlueprint[];
  readonly modulator: LfoBlueprint;
  readonly octaves: number;
  readonly stages: number;

  constructor(options: PhaserOptions = {}) {
    super("gain", { gain: 1 }, BLUEPRINT_PARAM_KEYS.gain);
    const sweep = createFilterSweep(options, { baseFrequency: 350, frequency: 0.5, octaves: 3 });
    this.baseFrequency = sweep.baseFrequency;
    this.depth = sweep.depth;
    this.modulator = sweep.modulator;
    this.octaves = sweep.octaves;
    this.stages = requirePositiveInteger(options.stages ?? 4, "stages");
    const Q = requireNonNegative(options.Q ?? 10, "Q");
    this.filters = Array.from({ length: this.stages }, () =>
      biquadFilter({ Q, frequency: 0, type: "allpass" }),
    );

    let previous: Blueprint | undefined;

    for (const filter of this.filters) {
      previous?.connect(filter);
      this.modulator.connect(filter.params.frequency);
      previous = filter;
    }

    if (previous !== undefined) {
      this.connectFrom(previous);
    }
  }

  override get input(): Blueprint {
    return this.filters[0] ?? this;
  }
}

/**
 * Creates a phaser blueprint: a chain of all-pass filters whose frequency an LFO sweeps. The output
 * is fully wet; mixing it with the dry signal produces the moving notches.
 */
export function phaser(options: PhaserOptions = {}): PhaserBlueprint {
  return new PhaserBlueprint(options);
}
