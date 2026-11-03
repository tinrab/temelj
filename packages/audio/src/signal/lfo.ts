import type { AudioContextLike } from "../context/context.ts";
import type { BlueprintParamsOf, GainBlueprint, OscillatorBlueprint } from "../graph/blueprint.ts";
import type { PlayContext } from "../graph/patch.ts";
import type { TimeExpression } from "../time/time.ts";
import type { Param } from "./param.ts";
import type { SignalBlueprint } from "./signal.ts";

import { BLUEPRINT_PARAM_KEYS, Blueprint, gain, oscillator } from "../graph/blueprint.ts";
import { createConstantSourceNode, createOscillatorNode } from "../native.ts";
import { OscillatorSource } from "../source/oscillator.ts";
import { clampNormal, requireFinite, requirePositive } from "../validation.ts";
import { createParam } from "./param.ts";
import { signal } from "./signal.ts";

export type LfoOptions = Omit<OscillatorOptions, "frequency"> & {
  readonly amplitude?: number;
  readonly frequency?: number;
  readonly max?: number;
  readonly min?: number;
  readonly type?: OscillatorType;
};

export type LfoScheduleOptions = {
  readonly bpm?: number;
  readonly time?: TimeExpression;
};

/**
 * Low-frequency oscillator scaled to [min, max]. Materialized as a gain node that sums the
 * scaled oscillator and a constant center offset.
 */
export class LfoBlueprint extends Blueprint<"gain", GainOptions, BlueprintParamsOf<"gain">> {
  readonly amplitude: number;
  readonly depth: GainBlueprint;
  readonly max: number;
  readonly min: number;
  readonly offset: SignalBlueprint;
  readonly oscillator: OscillatorBlueprint;

  constructor(options: LfoOptions = {}) {
    super("gain", { gain: 1 }, BLUEPRINT_PARAM_KEYS.gain);
    const { amplitude = 1, frequency = 1, max = 1, min = 0, type = "sine", ...rest } = options;
    this.amplitude = amplitude;
    this.max = max;
    this.min = min;
    this.oscillator = oscillator({ ...rest, frequency, type });
    this.depth = gain({ gain: ((max - min) / 2) * amplitude });
    this.offset = signal(min + (max - min) / 2);
    this.oscillator.connect(this.depth);
    this.depth.connect(this);
    this.offset.connect(this);
  }
}

/**
 * Creates a low-frequency oscillator blueprint that swings between `min` and `max`. Start it with
 * `startLfo()`.
 */
export function lfo(options: LfoOptions = {}): LfoBlueprint {
  return new LfoBlueprint(options);
}

/**
 * Oscillator scaled into [min, max] around a constant center, for modulating params.
 */
export class Lfo extends OscillatorSource {
  readonly oscillator: OscillatorNode;
  readonly amplitude: Param<"normalRange">;
  readonly output: GainNode;
  readonly #amplitudeGain: GainNode;
  readonly #depth: GainNode;
  readonly #center: ConstantSourceNode;
  #min: number;
  #max: number;

  constructor(context: AudioContextLike, options: LfoOptions = {}) {
    super(context);
    const { amplitude = 1, max = 1, min = 0, ...oscillatorOptions } = options;
    this.#min = requireFinite(min, "min");
    this.#max = requireFinite(max, "max");
    this.oscillator = this.source(createOscillatorNode(this.native, oscillatorOptions));
    this.#center = this.source(createConstantSourceNode(this.native, { offset: 0 }));
    this.#amplitudeGain = this.createGain(clampNormal(amplitude, "amplitude"));
    this.#depth = this.createGain();
    this.output = this.createGain();
    this.amplitude = createParam(this.#amplitudeGain.gain, "normalRange", () => this.now());
    this.oscillator.connect(this.#amplitudeGain).connect(this.#depth).connect(this.output);
    this.#center.connect(this.output);
    this.#applyRange(this.now());
  }

  get frequency(): AudioParam {
    return this.oscillator.frequency;
  }

  get min(): number {
    return this.#min;
  }

  get max(): number {
    return this.#max;
  }

  setAmplitude(amplitude: number, time: number = this.now()): void {
    this.#amplitudeGain.gain.setValueAtTime(clampNormal(amplitude, "amplitude"), time);
  }

  setFrequency(frequency: number, time: number = this.now()): void {
    this.oscillator.frequency.setValueAtTime(requirePositive(frequency, "frequency"), time);
  }

  setRange(min: number, max: number, time: number = this.now()): void {
    this.#min = requireFinite(min, "min");
    this.#max = requireFinite(max, "max");
    this.#applyRange(time);
  }

  #applyRange(time: number): void {
    this.#depth.gain.setValueAtTime((this.#max - this.#min) / 2, time);
    this.#center.offset.setValueAtTime(this.#min + (this.#max - this.#min) / 2, time);
  }
}

/**
 * Starts the oscillator of an LFO blueprint in a playback.
 */
export function startLfo(
  context: PlayContext,
  lfoBlueprint: LfoBlueprint,
  options: LfoScheduleOptions = {},
): void {
  context.start(lfoBlueprint.oscillator, { time: resolveScheduleTime(context, options) });
}

/**
 * Stops the LFO's oscillator at `options.time` (default now).
 */
export function stopLfo(
  context: PlayContext,
  lfoBlueprint: LfoBlueprint,
  options: LfoScheduleOptions = {},
): void {
  context.stop(lfoBlueprint.oscillator, resolveScheduleTime(context, options));
}

function resolveScheduleTime(
  context: PlayContext,
  options: LfoScheduleOptions,
): number | undefined {
  return options.time === undefined
    ? undefined
    : context.time.toSeconds(options.time, { bpm: options.bpm });
}
