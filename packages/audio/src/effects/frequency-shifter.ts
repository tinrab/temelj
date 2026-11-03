import type { AudioContextLike } from "../context/context.ts";
import type { RunState } from "../unit.ts";

import { AudioDisposedError } from "../errors.ts";
import {
  connectSeries,
  createGainNode,
  createIIRFilterNode,
  createOscillatorNode,
} from "../native.ts";
import { AudioNodeUnit, AudioUnitBase } from "../unit.ts";
import { clampNormal, requireFinite } from "../validation.ts";

export type FrequencyShifterOptions = {
  /**
   * Shift in hertz; negative values shift down.
   */
  readonly frequency?: number;
  /**
   * Level of the shifted signal added to the unchanged input, from 0 to 1. Defaults to 1.
   */
  readonly wet?: number;
};

// Coefficients of the two all-pass chains of a Hilbert transformer whose outputs are 90° apart.
const ALLPASS_COEFFICIENTS_A = [0.6923878, 0.9360654322959, 0.988229522686, 0.9987488452737];

const ALLPASS_COEFFICIENTS_B = [0.4021921162426, 0.856171088242, 0.9722909545651, 0.9952884791278];

/**
 * Hilbert transformer built from two IIR all-pass chains: splits the input into two outputs about
 * 90° apart.
 */
export class PhaseShiftAllpass extends AudioUnitBase {
  readonly input: GainNode;
  /**
   * In-phase output.
   */
  readonly output: GainNode;
  /**
   * Output shifted by 90°.
   */
  readonly offset90: GainNode;

  constructor(context: AudioContextLike) {
    super(context);
    const native = this.native;
    const nodes = this.nodes;

    const bank = (values: readonly number[]): IIRFilterNode[] =>
      values.map((value) =>
        nodes.add(
          createIIRFilterNode(native, {
            feedback: [1, 0, -(value * value)],
            feedforward: [value * value, 0, -1],
          }),
        ),
      );

    this.input = nodes.add(createGainNode(native, { gain: 1 }));
    this.output = nodes.add(createGainNode(native, { gain: 1 }));
    this.offset90 = nodes.add(createGainNode(native, { gain: 1 }));

    const oneSampleDelay = nodes.add(
      createIIRFilterNode(native, { feedback: [1, 0], feedforward: [0, 1] }),
    );

    connectSeries(this.input, ...bank(ALLPASS_COEFFICIENTS_A), oneSampleDelay, this.output);
    connectSeries(this.input, ...bank(ALLPASS_COEFFICIENTS_B), this.offset90);
  }
}

function createCosineOscillator(context: BaseAudioContext, frequency: number): OscillatorNode {
  return createOscillatorNode(context, {
    frequency,
    periodicWave: context.createPeriodicWave(Float32Array.from([0, 1]), Float32Array.from([0, 0])),
  });
}

/**
 * Single-sideband frequency shifter: moves every partial by a fixed number of hertz. The unchanged
 * input always passes through; the shifted signal is added on top, scaled by `wet`.
 */
export class FrequencyShifter extends AudioNodeUnit {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly #phaseShifter: PhaseShiftAllpass;
  readonly #wet: GainNode;
  readonly #carriers: readonly OscillatorNode[];
  #frequency: number;
  #state: RunState = "stopped";

  constructor(context: AudioContextLike, options: FrequencyShifterOptions = {}) {
    super(context);
    const native = this.native;
    const nodes = this.nodes;
    const gain = (value: number): GainNode => nodes.add(createGainNode(native, { gain: value }));
    this.#frequency = requireFinite(options.frequency ?? 0, "frequency");
    this.input = gain(1);
    this.output = gain(1);
    this.#wet = gain(clampNormal(options.wet ?? 1, "wet"));
    this.#phaseShifter = new PhaseShiftAllpass(native);

    const sine = nodes.addSource(
      createOscillatorNode(native, { frequency: this.#frequency, type: "sine" }),
    );

    const cosine = nodes.addSource(createCosineOscillator(native, this.#frequency));
    this.#carriers = [sine, cosine];
    const sineProduct = gain(0);
    const cosineProduct = gain(0);
    const invert = gain(-1);

    this.input.connect(gain(1)).connect(this.output);
    this.input.connect(this.#phaseShifter.input);
    // Ring-modulate the in-phase branch with the sine and the 90° branch with the cosine.
    this.#phaseShifter.output.connect(sineProduct);
    sine.connect(sineProduct.gain);
    this.#phaseShifter.offset90.connect(cosineProduct);
    cosine.connect(cosineProduct.gain);
    sineProduct.connect(invert).connect(this.#wet);
    cosineProduct.connect(this.#wet);
    this.#wet.connect(this.output);
  }

  get state(): RunState {
    return this.#state;
  }

  get frequency(): number {
    return this.#frequency;
  }

  get wet(): AudioParam {
    return this.#wet.gain;
  }

  start(time: number = this.now()): void {
    if (this.disposed) {
      AudioDisposedError.disposed("frequency shifter");
    }

    if (this.#state === "started") {
      return;
    }

    this.#state = "started";

    for (const carrier of this.#carriers) {
      carrier.start(time);
    }
  }

  stop(time: number = this.now()): void {
    if (this.#state === "stopped") {
      return;
    }

    this.#state = "stopped";

    for (const carrier of this.#carriers) {
      carrier.stop(time);
    }
  }

  setFrequency(frequency: number, time: number = this.now()): void {
    this.#frequency = requireFinite(frequency, "frequency");

    for (const carrier of this.#carriers) {
      carrier.frequency.setValueAtTime(this.#frequency, time);
    }
  }

  setWet(wet: number, time: number = this.now()): void {
    this.wet.setValueAtTime(clampNormal(wet, "wet"), time);
  }

  protected override teardown(): void {
    this.#state = "stopped";
    this.#phaseShifter.dispose();
  }
}
