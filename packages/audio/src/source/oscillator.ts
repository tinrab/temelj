/* oxlint-disable anti-slop/no-shape-in-symbol-names -- `WaveShaper` is the Web Audio API name (`WaveShaperNode`, `BaseAudioContext.createWaveShaper()`). */
import type { AudioContextLike } from "../context/context.ts";
import type { AudioDestination, AudioUnit, RunState } from "../unit.ts";

import { AudioRangeError } from "../errors.ts";
import {
  connectTo,
  createConstantSourceNode,
  createOscillatorNode,
  createWaveShaperNode,
} from "../native.ts";
import { AudioUnitBase } from "../unit.ts";
import {
  clampNormal,
  requireFinite,
  requireNonNegative,
  requirePositive,
  requirePositiveInteger,
} from "../validation.ts";

export type BasicOscillatorOptions = {
  readonly detune?: number;
  readonly frequency?: number;
  readonly type?: OscillatorType;
};

export type PulseOscillatorOptions = BasicOscillatorOptions & {
  /**
   * Duty cycle in [0, 1].
   */
  readonly width?: number;
};

export type PWMOscillatorOptions = {
  readonly detune?: number;
  readonly frequency?: number;
  readonly modulationDepth?: number;
  readonly modulationFrequency?: number;
};

export type FMOscillatorOptions = BasicOscillatorOptions & {
  /**
   * Modulator frequency as a multiple of the carrier frequency.
   */
  readonly harmonicity?: number;
  readonly modulationIndex?: number;
  readonly modulationType?: OscillatorType;
};

export type AMOscillatorOptions = BasicOscillatorOptions & {
  readonly harmonicity?: number;
  readonly modulationType?: OscillatorType;
};

export type UnisonOscillatorOptions = BasicOscillatorOptions & {
  /**
   * Number of detuned oscillators.
   */
  readonly count?: number;
  /**
   * Total detune spread in cents.
   */
  readonly spread?: number;
};

export type OmniOscillatorType =
  | OscillatorType
  | "am"
  | `am${OscillatorType}`
  | "unison"
  | `unison${OscillatorType}`
  | "fm"
  | `fm${OscillatorType}`
  | "pulse"
  | "pwm";

export type OmniOscillatorOptions = Omit<AMOscillatorOptions, "type"> &
  Omit<FMOscillatorOptions, "type"> &
  Omit<UnisonOscillatorOptions, "type"> &
  Omit<PulseOscillatorOptions, "type"> &
  PWMOscillatorOptions & {
    readonly type?: OmniOscillatorType;
  };

const CURVE_LENGTH = 4096;

/**
 * Shared shell for oscillator sources: owns the scheduled source nodes and starts and stops
 * them together.
 */
export abstract class OscillatorSource extends AudioUnitBase implements AudioUnit {
  abstract readonly output: AudioNode;
  readonly #sources: AudioScheduledSourceNode[] = [];
  #state: RunState = "stopped";
  #started = false;

  get state(): RunState {
    return this.#state;
  }

  connect<TDestination extends AudioDestination>(destination: TDestination): TDestination {
    return connectTo(this.output, destination);
  }

  disconnect(): void {
    this.output.disconnect();
  }

  abstract setFrequency(frequency: number, time?: number): void;

  /**
   * Starts every source. Native sources start once, so later calls are ignored.
   */
  start(time: number = this.now()): void {
    if (this.#started) {
      return;
    }

    this.#started = true;
    this.#state = "started";

    for (const source of this.#sources) {
      source.start(time);
    }
  }

  /**
   * Schedules every source to stop. Calling it again reschedules the stop.
   */
  stop(time: number = this.now()): void {
    if (!this.#started) {
      return;
    }

    this.#state = "stopped";

    for (const source of this.#sources) {
      source.stop(time);
    }
  }

  protected override teardown(): void {
    this.#state = "stopped";
  }

  /**
   * Calls `listener` once, when the oscillator's sources have stopped.
   */
  onEnded(listener: () => void): void {
    this.#sources[0]?.addEventListener("ended", listener, { once: true });
  }

  /**
   * Registers a source node started and stopped with this oscillator.
   */
  protected source<Node extends AudioScheduledSourceNode>(node: Node): Node {
    this.#sources.push(node);

    return this.nodes.addSource(node);
  }

  protected createCurveNode(curve: Float32Array<ArrayBuffer>): WaveShaperNode {
    return this.nodes.add(createWaveShaperNode(this.native, { curve }));
  }
}

/**
 * Source built around one native oscillator.
 */
abstract class SingleOscillatorSource extends OscillatorSource {
  readonly oscillator: OscillatorNode;

  constructor(context: AudioContextLike, options: BasicOscillatorOptions, type: OscillatorType) {
    super(context);
    this.oscillator = this.source(
      createOscillatorNode(this.native, {
        detune: requireFinite(options.detune ?? 0, "detune"),
        frequency: requirePositive(options.frequency ?? 440, "frequency"),
        type: options.type ?? type,
      }),
    );
  }

  get detune(): AudioParam {
    return this.oscillator.detune;
  }

  get frequency(): AudioParam {
    return this.oscillator.frequency;
  }

  get type(): OscillatorType {
    return this.oscillator.type;
  }

  setFrequency(frequency: number, time: number = this.now()): void {
    this.oscillator.frequency.setValueAtTime(requirePositive(frequency, "frequency"), time);
  }

  setType(type: OscillatorType): void {
    this.oscillator.type = type;
  }
}

/**
 * One native oscillator.
 */
export class BasicOscillator extends SingleOscillatorSource {
  constructor(context: AudioContextLike, options: BasicOscillatorOptions = {}) {
    super(context, options, "sine");
  }

  get output(): OscillatorNode {
    return this.oscillator;
  }
}

/**
 * Oscillator passed through a threshold curve, giving a pulse wave that is high for `width` of each
 * period.
 */
export class PulseOscillator extends SingleOscillatorSource {
  readonly curveNode: WaveShaperNode;
  #width: number;

  constructor(context: AudioContextLike, options: PulseOscillatorOptions = {}) {
    super(context, options, "sawtooth");
    this.#width = clampNormal(options.width ?? 0.5, "width");
    this.curveNode = this.createCurveNode(createPulseCurve(this.#width));
    this.oscillator.connect(this.curveNode);
  }

  get output(): WaveShaperNode {
    return this.curveNode;
  }

  get width(): number {
    return this.#width;
  }

  setWidth(width: number): void {
    this.#width = clampNormal(width, "width");
    this.curveNode.curve = createPulseCurve(this.#width);
  }
}

/**
 * Pulse-width modulation: a triangle compared against a sine-modulated threshold.
 */
export class PWMOscillator extends OscillatorSource {
  readonly carrier: OscillatorNode;
  readonly modulator: OscillatorNode;
  readonly curveNode: WaveShaperNode;
  readonly #modulationGain: GainNode;

  constructor(context: AudioContextLike, options: PWMOscillatorOptions = {}) {
    super(context);
    this.carrier = this.source(
      createOscillatorNode(this.native, {
        detune: requireFinite(options.detune ?? 0, "detune"),
        frequency: requirePositive(options.frequency ?? 440, "frequency"),
        type: "triangle",
      }),
    );
    this.modulator = this.source(
      createOscillatorNode(this.native, {
        frequency: requirePositive(options.modulationFrequency ?? 0.4, "modulationFrequency"),
        type: "sine",
      }),
    );
    this.#modulationGain = this.createGain(
      clampNormal(options.modulationDepth ?? 0.5, "modulationDepth"),
    );
    this.curveNode = this.createCurveNode(createThresholdCurve());
    this.carrier.connect(this.curveNode);
    this.modulator.connect(this.#modulationGain).connect(this.curveNode);
  }

  get output(): WaveShaperNode {
    return this.curveNode;
  }

  get detune(): AudioParam {
    return this.carrier.detune;
  }

  get frequency(): AudioParam {
    return this.carrier.frequency;
  }

  get modulationDepth(): AudioParam {
    return this.#modulationGain.gain;
  }

  get modulationFrequency(): AudioParam {
    return this.modulator.frequency;
  }

  setFrequency(frequency: number, time: number = this.now()): void {
    this.carrier.frequency.setValueAtTime(requirePositive(frequency, "frequency"), time);
  }

  setModulationDepth(depth: number, time: number = this.now()): void {
    this.#modulationGain.gain.setValueAtTime(clampNormal(depth, "modulationDepth"), time);
  }

  setModulationFrequency(frequency: number, time: number = this.now()): void {
    this.modulator.frequency.setValueAtTime(
      requirePositive(frequency, "modulationFrequency"),
      time,
    );
  }
}

/**
 * Carrier and modulator a harmonicity ratio apart, shared by the AM and FM oscillators.
 */
abstract class ModulatedOscillator extends OscillatorSource {
  readonly carrier: OscillatorNode;
  readonly modulator: OscillatorNode;
  protected baseFrequency: number;
  #harmonicity: number;

  constructor(
    context: AudioContextLike,
    options: FMOscillatorOptions,
    carrierFollowsFrequency: boolean,
  ) {
    super(context);
    const detune = requireFinite(options.detune ?? 0, "detune");
    this.baseFrequency = requirePositive(options.frequency ?? 440, "frequency");
    this.#harmonicity = requirePositive(options.harmonicity ?? 1, "harmonicity");
    this.modulator = createOscillatorNode(this.native, {
      detune,
      frequency: this.baseFrequency * this.#harmonicity,
      type: options.modulationType ?? "square",
    });
    this.carrier = createOscillatorNode(this.native, {
      detune,
      frequency: carrierFollowsFrequency ? this.baseFrequency : 0,
      type: options.type ?? "sine",
    });
  }

  get detune(): AudioParam {
    return this.carrier.detune;
  }

  get harmonicity(): number {
    return this.#harmonicity;
  }

  get modulationType(): OscillatorType {
    return this.modulator.type;
  }

  get type(): OscillatorType {
    return this.carrier.type;
  }

  setFrequency(frequency: number, time: number = this.now()): void {
    this.baseFrequency = requirePositive(frequency, "frequency");
    this.applyFrequency(time);
    this.modulator.frequency.setValueAtTime(this.baseFrequency * this.#harmonicity, time);
  }

  setHarmonicity(harmonicity: number, time: number = this.now()): void {
    this.#harmonicity = requirePositive(harmonicity, "harmonicity");
    this.modulator.frequency.setValueAtTime(this.baseFrequency * this.#harmonicity, time);
  }

  setModulationType(type: OscillatorType): void {
    this.modulator.type = type;
  }

  setType(type: OscillatorType): void {
    this.carrier.type = type;
  }

  protected abstract applyFrequency(time: number): void;
}

/**
 * Frequency modulation: the modulator, scaled by `frequency × modulationIndex`, is added to the
 * carrier frequency.
 */
export class FMOscillator extends ModulatedOscillator {
  /**
   * Carrier base frequency source.
   */
  readonly frequency: ConstantSourceNode;
  readonly modulationGain: GainNode;
  #modulationIndex: number;

  constructor(context: AudioContextLike, options: FMOscillatorOptions = {}) {
    super(context, options, false);
    this.#modulationIndex = requireNonNegative(options.modulationIndex ?? 2, "modulationIndex");
    this.frequency = this.source(
      createConstantSourceNode(this.native, { offset: this.baseFrequency }),
    );
    this.source(this.modulator);
    this.source(this.carrier);
    this.modulationGain = this.createGain(this.baseFrequency * this.#modulationIndex);
    this.frequency.connect(this.carrier.frequency);
    this.modulator.connect(this.modulationGain).connect(this.carrier.frequency);
  }

  get output(): OscillatorNode {
    return this.carrier;
  }

  get modulationIndex(): number {
    return this.#modulationIndex;
  }

  setModulationIndex(modulationIndex: number, time: number = this.now()): void {
    this.#modulationIndex = requireNonNegative(modulationIndex, "modulationIndex");
    this.modulationGain.gain.setValueAtTime(this.baseFrequency * this.#modulationIndex, time);
  }

  protected applyFrequency(time: number): void {
    this.frequency.offset.setValueAtTime(this.baseFrequency, time);
    this.modulationGain.gain.setValueAtTime(this.baseFrequency * this.#modulationIndex, time);
  }
}

/**
 * Amplitude modulation: the modulator, rescaled to [0, 1], drives the carrier gain.
 */
export class AMOscillator extends ModulatedOscillator {
  readonly modulationGain: GainNode;
  readonly modulationScale: WaveShaperNode;

  constructor(context: AudioContextLike, options: AMOscillatorOptions = {}) {
    super(context, options, true);
    this.source(this.modulator);
    this.source(this.carrier);
    this.modulationScale = this.createCurveNode(createAudioToGainCurve());
    this.modulationGain = this.createGain(0);
    this.modulator.connect(this.modulationScale).connect(this.modulationGain.gain);
    this.carrier.connect(this.modulationGain);
  }

  get output(): GainNode {
    return this.modulationGain;
  }

  protected applyFrequency(time: number): void {
    this.carrier.frequency.setValueAtTime(this.baseFrequency, time);
  }
}

/**
 * `count` oscillators (3 by default) spread evenly across `spread` cents (20 by default) and mixed
 * at `1 / count` gain each.
 */
export class UnisonOscillator extends OscillatorSource {
  readonly oscillators: readonly OscillatorNode[];
  readonly volume: GainNode;
  #detune: number;
  #frequency: number;
  #spread: number;
  #type: OscillatorType;

  constructor(context: AudioContextLike, options: UnisonOscillatorOptions = {}) {
    super(context);
    const count = requirePositiveInteger(options.count ?? 3, "count");
    this.#detune = requireFinite(options.detune ?? 0, "detune");
    this.#frequency = requirePositive(options.frequency ?? 440, "frequency");
    this.#spread = requireNonNegative(options.spread ?? 20, "spread");
    this.#type = options.type ?? "sawtooth";
    this.volume = this.createGain(1 / count);
    this.oscillators = Array.from({ length: count }, (_, index) => {
      const oscillator = this.source(
        createOscillatorNode(this.native, {
          detune: this.#detuneOf(index, count),
          frequency: this.#frequency,
          type: this.#type,
        }),
      );

      oscillator.connect(this.volume);

      return oscillator;
    });
  }

  get output(): GainNode {
    return this.volume;
  }

  get detune(): number {
    return this.#detune;
  }

  get frequency(): number {
    return this.#frequency;
  }

  get spread(): number {
    return this.#spread;
  }

  get type(): OscillatorType {
    return this.#type;
  }

  setDetune(detune: number, time: number = this.now()): void {
    this.#detune = requireFinite(detune, "detune");
    this.#applyDetune(time);
  }

  setFrequency(frequency: number, time: number = this.now()): void {
    this.#frequency = requirePositive(frequency, "frequency");

    for (const oscillator of this.oscillators) {
      oscillator.frequency.setValueAtTime(this.#frequency, time);
    }
  }

  setSpread(spread: number, time: number = this.now()): void {
    this.#spread = requireNonNegative(spread, "spread");
    this.#applyDetune(time);
  }

  setType(type: OscillatorType): void {
    this.#type = type;

    for (const oscillator of this.oscillators) {
      oscillator.type = type;
    }
  }

  #applyDetune(time: number): void {
    this.oscillators.forEach((oscillator, index) => {
      oscillator.detune.setValueAtTime(this.#detuneOf(index, this.oscillators.length), time);
    });
  }

  #detuneOf(index: number, count: number): number {
    const offset = count === 1 ? 0 : -this.#spread / 2 + (this.#spread * index) / (count - 1);

    return offset + this.#detune;
  }
}

export type OmniOscillatorSource =
  | AMOscillator
  | BasicOscillator
  | UnisonOscillator
  | FMOscillator
  | PulseOscillator
  | PWMOscillator;

/**
 * Oscillator whose implementation is chosen by `type` (`"fmsine"`, `"unison"`, `"pwm"`, …) and can
 * be swapped while running.
 */
export class OmniOscillator extends AudioUnitBase implements AudioUnit {
  readonly output: GainNode;
  readonly #options: OmniOscillatorOptions;
  #oscillator: OmniOscillatorSource;
  #type: OmniOscillatorType;

  constructor(context: AudioContextLike, options: OmniOscillatorOptions = {}) {
    super(context);
    this.#options = options;
    this.#type = options.type ?? "sine";
    this.output = this.createGain();
    this.#oscillator = createOmniSource(context, this.#type, options);
    this.#oscillator.connect(this.output);
  }

  get oscillator(): OmniOscillatorSource {
    return this.#oscillator;
  }

  get state(): RunState {
    return this.#oscillator.state;
  }

  get type(): OmniOscillatorType {
    return this.#type;
  }

  connect<TDestination extends AudioDestination>(destination: TDestination): TDestination {
    return connectTo(this.output, destination);
  }

  disconnect(): void {
    this.output.disconnect();
  }

  setFrequency(frequency: number, time?: number): void {
    this.#oscillator.setFrequency(frequency, time);
  }

  setType(type: OmniOscillatorType): void {
    if (type === this.#type) {
      return;
    }

    const next = createOmniSource(this.context, type, this.#options);
    next.connect(this.output);

    if (this.#oscillator.state === "started") {
      next.start();
    }

    this.#oscillator.dispose();
    this.#oscillator = next;
    this.#type = type;
  }

  start(time?: number): void {
    this.#oscillator.start(time);
  }

  stop(time?: number): void {
    this.#oscillator.stop(time);
  }

  protected override teardown(): void {
    this.#oscillator.dispose();
  }
}

function createOmniSource(
  context: AudioContextLike,
  type: OmniOscillatorType,
  options: OmniOscillatorOptions,
): OmniOscillatorSource {
  if (type === "pwm") {
    return new PWMOscillator(context, options);
  }

  if (type === "pulse") {
    return new PulseOscillator(context, { ...options, type: "sawtooth" });
  }

  for (const [prefix, fallback] of [
    ["am", "sine"],
    ["fm", "sine"],
    ["unison", "sawtooth"],
  ] as const) {
    if (type.startsWith(prefix)) {
      const waveform = type === prefix ? fallback : parseOscillatorType(type.slice(prefix.length));
      const sourceOptions = { ...options, type: waveform };

      switch (prefix) {
        case "am":
          return new AMOscillator(context, sourceOptions);
        case "fm":
          return new FMOscillator(context, sourceOptions);
        case "unison":
          return new UnisonOscillator(context, sourceOptions);
      }
    }
  }

  return new BasicOscillator(context, { ...options, type: parseOscillatorType(type) });
}

function parseOscillatorType(type: string): OscillatorType {
  if (type === "sine" || type === "square" || type === "sawtooth" || type === "triangle") {
    return type;
  }

  return AudioRangeError.invalidOption("type", type);
}

function createCurve(map: (input: number) => number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(CURVE_LENGTH);

  for (let i = 0; i < CURVE_LENGTH; i++) {
    curve[i] = map((i / (CURVE_LENGTH - 1)) * 2 - 1);
  }

  return curve;
}

function createPulseCurve(width: number): Float32Array<ArrayBuffer> {
  // A sawtooth or triangle spends `(1 - threshold) / 2` of each period above `threshold`, so this
  // threshold keeps the output high for `width` of the period.
  const threshold = 1 - width * 2;

  return createCurve((input) => (input < threshold ? -1 : 1));
}

function createThresholdCurve(): Float32Array<ArrayBuffer> {
  return createCurve((input) => (input <= 0 ? -1 : 1));
}

function createAudioToGainCurve(): Float32Array<ArrayBuffer> {
  return createCurve((input) => (input + 1) / 2);
}
