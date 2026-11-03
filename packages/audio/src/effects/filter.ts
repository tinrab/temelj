import type { AudioSourceCandidate } from "../buffer/loading.ts";
import type { AudioContextLike } from "../context/context.ts";

import { loadAudio } from "../buffer/loading.ts";
import { AudioRangeError } from "../errors.ts";
import {
  connectSeries,
  createBiquadFilterNode,
  createConvolverNode,
  createDelayNode,
  createIIRFilterNode,
} from "../native.ts";
import { AudioNodeUnit } from "../unit.ts";
import { requireFinite, requireInRange, requirePositive } from "../validation.ts";

export type FilterRolloff = -12 | -24 | -48 | -96;

export type OnePoleFilterType = "highpass" | "lowpass";

export type FilterOptions = BiquadFilterOptions & {
  readonly rolloff?: FilterRolloff;
};

export type OnePoleFilterOptions = {
  readonly frequency?: number;
  readonly type?: OnePoleFilterType;
};

export type IIRFilterCoefficients = {
  readonly feedback: readonly number[];
  readonly feedforward: readonly number[];
};

export type ConvolverOptions = {
  readonly buffer?: AudioBuffer | null;
  readonly normalize?: boolean;
};

export type FeedbackCombFilterOptions = {
  readonly delayTime?: number;
  readonly resonance?: number;
};

export type LowpassCombFilterOptions = FeedbackCombFilterOptions & {
  readonly dampening?: number;
};

const ROLLOFFS: readonly FilterRolloff[] = [-12, -24, -48, -96];

/**
 * Biquad filter cascaded to a steeper rolloff (-12 dB/octave per stage). The param getters
 * (`frequency`, `Q`, …) return the first stage's `AudioParam`; use the setters to change every
 * stage.
 */
export class Filter extends AudioNodeUnit {
  readonly input: GainNode;
  readonly output: GainNode;
  #filters: readonly BiquadFilterNode[] = [];
  #settings: Required<Omit<BiquadFilterOptions, keyof AudioNodeOptions>>;
  #rolloff: FilterRolloff;

  constructor(context: AudioContextLike, options: FilterOptions = {}) {
    super(context);
    this.input = this.createGain();
    this.output = this.createGain();
    this.#settings = {
      detune: requireFinite(options.detune ?? 0, "detune"),
      frequency: requirePositive(options.frequency ?? 350, "frequency"),
      gain: requireFinite(options.gain ?? 0, "gain"),
      Q: requirePositive(options.Q ?? 1, "Q"),
      type: options.type ?? "lowpass",
    };
    this.#rolloff = requireRolloff(options.rolloff ?? -12);
    this.#rebuild();
  }

  get filters(): readonly BiquadFilterNode[] {
    return this.#filters;
  }

  get detune(): AudioParam {
    return this.#first.detune;
  }

  get frequency(): AudioParam {
    return this.#first.frequency;
  }

  get gain(): AudioParam {
    return this.#first.gain;
  }

  get Q(): AudioParam {
    return this.#first.Q;
  }

  get rolloff(): FilterRolloff {
    return this.#rolloff;
  }

  get type(): BiquadFilterType {
    return this.#settings.type;
  }

  getFrequencyResponse(length = 128): Float32Array {
    const frequencies = createLogFrequencyBins(length);
    const total = new Float32Array(frequencies.length).fill(1);

    for (const filter of this.#filters) {
      const magnitude = getMagnitudeResponse(filter, frequencies);

      for (let i = 0; i < total.length; i++) {
        total[i]! *= magnitude[i]!;
      }
    }

    return total;
  }

  setDetune(value: number, time: number = this.now()): void {
    this.#settings.detune = requireFinite(value, "detune");
    this.#forEach((filter) => filter.detune.setValueAtTime(this.#settings.detune, time));
  }

  setFrequency(value: number, time: number = this.now()): void {
    this.#settings.frequency = requirePositive(value, "frequency");
    this.#forEach((filter) => filter.frequency.setValueAtTime(this.#settings.frequency, time));
  }

  setGain(value: number, time: number = this.now()): void {
    this.#settings.gain = requireFinite(value, "gain");
    this.#forEach((filter) => filter.gain.setValueAtTime(this.#settings.gain, time));
  }

  setQ(value: number, time: number = this.now()): void {
    this.#settings.Q = requirePositive(value, "Q");
    this.#forEach((filter) => filter.Q.setValueAtTime(this.#settings.Q, time));
  }

  setRolloff(rolloff: FilterRolloff): void {
    if (requireRolloff(rolloff) !== this.#rolloff) {
      this.#rolloff = rolloff;
      this.#rebuild();
    }
  }

  setType(type: BiquadFilterType): void {
    this.#settings.type = type;
    this.#forEach((filter) => {
      filter.type = type;
    });
  }

  protected override teardown(): void {
    this.#forEach((filter) => filter.disconnect());
  }

  get #first(): BiquadFilterNode {
    // SAFETY: `#rebuild` always creates at least one stage.
    return this.#filters[0] as BiquadFilterNode;
  }

  #forEach(action: (filter: BiquadFilterNode) => void): void {
    for (const filter of this.#filters) {
      action(filter);
    }
  }

  #rebuild(): void {
    this.input.disconnect();
    this.#forEach((filter) => filter.disconnect());
    this.#filters = Array.from({ length: Math.abs(this.#rolloff) / 12 }, () =>
      createBiquadFilterNode(this.native, this.#settings),
    );
    connectSeries(this.input, ...this.#filters, this.output);
  }
}

/**
 * First-order IIR low-pass or high-pass filter. Changing settings swaps the IIR node.
 */
export class OnePoleFilter extends AudioNodeUnit {
  readonly input: GainNode;
  readonly output: GainNode;
  #filter: IIRFilterNode;
  #frequency: number;
  #type: OnePoleFilterType;

  constructor(context: AudioContextLike, options: OnePoleFilterOptions = {}) {
    super(context);
    this.input = this.createGain();
    this.output = this.createGain();
    this.#frequency = requirePositive(options.frequency ?? 880, "frequency");
    this.#type = options.type ?? "lowpass";
    this.#filter = this.#createFilter();
  }

  get filter(): IIRFilterNode {
    return this.#filter;
  }

  get frequency(): number {
    return this.#frequency;
  }

  get type(): OnePoleFilterType {
    return this.#type;
  }

  getFrequencyResponse(length = 128): Float32Array {
    return getMagnitudeResponse(this.#filter, createLogFrequencyBins(length));
  }

  setFrequency(frequency: number): void {
    this.#frequency = requirePositive(frequency, "frequency");
    this.#replaceFilter();
  }

  setType(type: OnePoleFilterType): void {
    this.#type = type;
    this.#replaceFilter();
  }

  protected override teardown(): void {
    this.#filter.disconnect();
  }

  #createFilter(): IIRFilterNode {
    const filter = createIIRFilterNode(
      this.native,
      getOnePoleCoefficients(this.native.sampleRate, this.#frequency, this.#type),
    );

    connectSeries(this.input, filter, this.output);

    return filter;
  }

  #replaceFilter(): void {
    this.input.disconnect();
    this.#filter.disconnect();
    this.#filter = this.#createFilter();
  }
}

/**
 * `IIRFilterNode` with validated coefficients. `getFrequencyResponse()` samples log-spaced
 * frequencies from 20 Hz to 20 kHz.
 */
export class IIRFilter extends AudioNodeUnit {
  readonly filter: IIRFilterNode;
  readonly coefficients: IIRFilterCoefficients;

  constructor(context: AudioContextLike, coefficients: IIRFilterCoefficients) {
    super(context);
    this.coefficients = {
      feedback: requireCoefficients(coefficients.feedback, "feedback"),
      feedforward: requireCoefficients(coefficients.feedforward, "feedforward"),
    };

    if (this.coefficients.feedback[0] === 0) {
      AudioRangeError.invalidOption("feedback[0]", 0);
    }

    this.filter = this.nodes.add(createIIRFilterNode(this.native, this.coefficients));
  }

  get input(): IIRFilterNode {
    return this.filter;
  }

  get output(): IIRFilterNode {
    return this.filter;
  }

  getFrequencyResponse(length = 128): Float32Array {
    return getMagnitudeResponse(this.filter, createLogFrequencyBins(length));
  }
}

/**
 * Convolver whose impulse response can be replaced or loaded after construction.
 */
export class Convolver extends AudioNodeUnit {
  readonly input: GainNode;
  readonly output: GainNode;
  #convolver: ConvolverNode;

  constructor(context: AudioContextLike, options: ConvolverOptions = {}) {
    super(context);
    this.input = this.createGain();
    this.output = this.createGain();
    this.#convolver = this.#createConvolver(options.buffer ?? null, options.normalize ?? true);
  }

  get convolver(): ConvolverNode {
    return this.#convolver;
  }

  get buffer(): AudioBuffer | null {
    return this.#convolver.buffer;
  }

  get normalize(): boolean {
    return this.#convolver.normalize;
  }

  /**
   * Sets the impulse response. A `ConvolverNode` buffer can be set once, so later buffers
   * replace the node.
   */
  setBuffer(buffer: AudioBuffer | null): void {
    if (this.#convolver.buffer === null) {
      this.#convolver.buffer = buffer;

      return;
    }

    this.input.disconnect();
    this.#convolver.disconnect();
    this.#convolver = this.#createConvolver(buffer, this.#convolver.normalize);
  }

  setNormalize(normalize: boolean): void {
    this.#convolver.normalize = normalize;
  }

  async load(source: AudioSourceCandidate | readonly AudioSourceCandidate[]): Promise<AudioBuffer> {
    const buffer = await loadAudio(this.context, source);
    this.setBuffer(buffer);

    return buffer;
  }

  protected override teardown(): void {
    this.#convolver.disconnect();
  }

  #createConvolver(buffer: AudioBuffer | null, normalize: boolean): ConvolverNode {
    const convolver = createConvolverNode(this.native, { buffer, normalize });
    connectSeries(this.input, convolver, this.output);

    return convolver;
  }
}

/**
 * Delay line fed back into itself.
 */
export class FeedbackCombFilter extends AudioNodeUnit {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly delay: DelayNode;
  readonly feedback: GainNode;

  constructor(context: AudioContextLike, options: FeedbackCombFilterOptions = {}) {
    super(context);
    this.input = this.createGain();
    this.output = this.createGain();
    this.delay = this.nodes.add(
      createDelayNode(this.native, {
        delayTime: requirePositive(options.delayTime ?? 0.1, "delayTime"),
        maxDelayTime: 1,
      }),
    );
    this.feedback = this.createGain(requireResonance(options.resonance ?? 0.5));
    this.input.connect(this.delay);
    this.delay.connect(this.output);
    this.delay.connect(this.feedback).connect(this.delay);
  }

  get delayTime(): AudioParam {
    return this.delay.delayTime;
  }

  get resonance(): AudioParam {
    return this.feedback.gain;
  }

  setDelayTime(value: number, time: number = this.now()): void {
    this.delay.delayTime.setValueAtTime(requirePositive(value, "delayTime"), time);
  }

  setResonance(value: number, time: number = this.now()): void {
    this.feedback.gain.setValueAtTime(requireResonance(value), time);
  }
}

/**
 * Feedback comb filter whose input passes through a low-pass dampening filter.
 */
export class LowpassCombFilter extends FeedbackCombFilter {
  readonly lowpass: BiquadFilterNode;

  constructor(context: AudioContextLike, options: LowpassCombFilterOptions = {}) {
    super(context, options);
    this.lowpass = this.nodes.add(
      createBiquadFilterNode(this.native, {
        frequency: requirePositive(options.dampening ?? 3_000, "dampening"),
        type: "lowpass",
      }),
    );
    this.input.disconnect();
    this.input.connect(this.lowpass).connect(this.delay);
  }

  get dampening(): AudioParam {
    return this.lowpass.frequency;
  }

  setDampening(value: number, time: number = this.now()): void {
    this.lowpass.frequency.setValueAtTime(requirePositive(value, "dampening"), time);
  }
}

/**
 * Feedback gain in [-1, 1]; negative values invert the fed-back signal.
 */
function requireResonance(value: number): number {
  return requireInRange(value, -1, 1, "resonance");
}

function requireRolloff(rolloff: number): FilterRolloff {
  const match = ROLLOFFS.find((candidate) => candidate === rolloff);

  return match ?? AudioRangeError.invalidOption("rolloff", rolloff);
}

function requireCoefficients(coefficients: readonly number[], name: string): readonly number[] {
  if (coefficients.length === 0) {
    AudioRangeError.invalidOption(name, coefficients);
  }

  return coefficients.map((value, index) => requireFinite(value, `${name}[${index}]`));
}

function getOnePoleCoefficients(
  sampleRate: number,
  frequency: number,
  type: OnePoleFilterType,
): IIRFilterCoefficients {
  const timeConstant = 1 / (2 * Math.PI * frequency);
  const a0 = 1 / (timeConstant * sampleRate);

  return type === "lowpass"
    ? { feedback: [1, a0 - 1], feedforward: [a0, 0] }
    : { feedback: [1, a0 - 1], feedforward: [1, -1] };
}

function getMagnitudeResponse(
  filter: BiquadFilterNode | IIRFilterNode,
  frequencies: Float32Array<ArrayBuffer>,
): Float32Array<ArrayBuffer> {
  const magnitude = new Float32Array(frequencies.length);
  const phase = new Float32Array(frequencies.length);
  filter.getFrequencyResponse(frequencies, magnitude, phase);

  return magnitude;
}

/**
 * `length` log-spaced frequencies from 20 Hz to 20 kHz.
 */
function createLogFrequencyBins(length: number): Float32Array<ArrayBuffer> {
  const size = Math.max(1, Math.floor(length));
  const min = Math.log10(20);
  const max = Math.log10(20_000);
  const bins = new Float32Array(size);

  if (size === 1) {
    bins[0] = 20;

    return bins;
  }

  for (let i = 0; i < size; i++) {
    bins[i] = 10 ** (min + (max - min) * (i / (size - 1)));
  }

  return bins;
}
