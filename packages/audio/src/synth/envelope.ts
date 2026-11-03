import { isFunction, isString } from "@temelj/value";

import type { AudioContextLike } from "../context/context.ts";
import type { TimeExpression } from "../time/time.ts";
import type { AudioDestination, AudioUnit, RunState } from "../unit.ts";

import { AudioRangeError } from "../errors.ts";
import { connectTo, createConstantSourceNode } from "../native.ts";
import { noteToFrequency } from "../time/pitch.ts";
import { toSeconds as parseTimeExpression } from "../time/time.ts";
import { AudioNodeUnit, AudioUnitBase } from "../unit.ts";
import { requireNonNegative, requirePositive } from "../validation.ts";

export type EnvelopeCurve = "exponential" | "linear";

export type EnvelopeOptions = {
  readonly attack?: TimeExpression;
  readonly attackCurve?: EnvelopeCurve;
  readonly decay?: TimeExpression;
  readonly decayCurve?: EnvelopeCurve;
  readonly max?: number;
  readonly min?: number;
  readonly release?: TimeExpression;
  readonly releaseCurve?: EnvelopeCurve;
  readonly sustain?: number;
};

export type EnvelopeTriggerOptions = {
  readonly bpm?: number;
  readonly now?: number;
  readonly velocity?: number;
};

export type AmplitudeEnvelopeOptions = EnvelopeOptions & {
  readonly gain?: number;
};

export type FrequencyEnvelopeBaseFrequency = number | string;

export type FrequencyEnvelopeOptions = EnvelopeOptions & {
  readonly baseFrequency?: FrequencyEnvelopeBaseFrequency;
  readonly exponent?: number;
  readonly octaves?: number;
};

const DEFAULT_ATTACK = 0.01;

const DEFAULT_DECAY = 0.1;

const DEFAULT_RELEASE = 1;

const DEFAULT_SUSTAIN = 0.5;

const DEFAULT_BPM = 120;

const EXPONENTIAL_FLOOR = 0.000_001;

/**
 * The attack last scheduled on a param. Engines without `cancelAndHoldAtTime`, such as Firefox 158,
 * lose the current level when automation is cancelled, so a release recomputes it from here.
 */
type ScheduledAttack = {
  readonly start: number;
  readonly from: number;
  readonly attackEnd: number;
  readonly attackCurve: EnvelopeCurve;
  readonly peak: number;
  readonly decayEnd: number;
  readonly decayCurve: EnvelopeCurve;
  readonly sustain: number;
};

function rampValue(
  from: number,
  to: number,
  startTime: number,
  endTime: number,
  time: number,
  curve: EnvelopeCurve,
): number {
  if (time >= endTime || endTime <= startTime) {
    return to;
  }

  const progress = (time - startTime) / (endTime - startTime);

  if (curve === "exponential") {
    const start = Math.max(from, EXPONENTIAL_FLOOR);

    return start * (Math.max(to, EXPONENTIAL_FLOOR) / start) ** progress;
  }

  return from + (to - from) * progress;
}

function levelAt(attack: ScheduledAttack, time: number): number {
  if (time < attack.start) {
    return attack.from;
  }

  if (time < attack.attackEnd) {
    return rampValue(
      attack.from,
      attack.peak,
      attack.start,
      attack.attackEnd,
      time,
      attack.attackCurve,
    );
  }

  return rampValue(
    attack.peak,
    attack.sustain,
    attack.attackEnd,
    attack.decayEnd,
    time,
    attack.decayCurve,
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function assertFiniteDuration(value: number, name: string): number {
  return requireNonNegative(value, name);
}

function assertCurve(value: EnvelopeCurve, name: string): EnvelopeCurve {
  if (value !== "linear" && value !== "exponential") {
    AudioRangeError.invalidOption(name, value);
  }

  return value;
}

function resolveDuration(
  time: TimeExpression | undefined,
  fallback: number,
  options: { readonly bpm: number; readonly now: number },
): number {
  if (time === undefined) {
    return fallback;
  }

  return parseTimeExpression(time, options);
}

/**
 * Cancels automation after `time` and holds the level there. `level` is the value at `time`
 * when known; it is only needed where `cancelAndHoldAtTime` is missing.
 */
function cancelAndHold(audioParam: AudioParam, time: number, level?: number): void {
  // SAFETY: `cancelAndHoldAtTime` is missing in Firefox 158; it is checked before use.
  const param = audioParam as AudioParam & {
    cancelAndHoldAtTime?: (cancelTime: number) => AudioParam;
  };

  if (isFunction(param.cancelAndHoldAtTime)) {
    param.cancelAndHoldAtTime(time);

    return;
  }

  audioParam.cancelScheduledValues(time);
  audioParam.setValueAtTime(level ?? audioParam.value, time);
}

function rampTo(
  audioParam: AudioParam,
  value: number,
  endTime: number,
  curve: EnvelopeCurve,
): void {
  if (curve === "exponential") {
    audioParam.exponentialRampToValueAtTime(Math.max(value, EXPONENTIAL_FLOOR), endTime);

    return;
  }

  audioParam.linearRampToValueAtTime(value, endTime);
}

function resolveFrequency(value: FrequencyEnvelopeBaseFrequency, name: string): number {
  const frequency = isString(value) ? noteToFrequency(value) : value;

  return requirePositive(frequency, name);
}

/**
 * ADSR envelope scheduled on an `AudioParam`. Stage durations are time expressions. The note's peak
 * sits between `min` and `max` in proportion to velocity, and `sustain` (0–1) is the fraction of
 * the way from `min` to that peak.
 */
export class Envelope {
  attack: TimeExpression;
  attackCurve: EnvelopeCurve;
  decay: TimeExpression;
  decayCurve: EnvelopeCurve;
  max: number;
  min: number;
  release: TimeExpression;
  releaseCurve: EnvelopeCurve;
  sustain: number;
  #disposed = false;
  #state: RunState = "stopped";
  readonly #attacks = new WeakMap<AudioParam, ScheduledAttack>();

  constructor(options: EnvelopeOptions = {}) {
    this.attack = options.attack ?? DEFAULT_ATTACK;
    this.attackCurve = assertCurve(options.attackCurve ?? "linear", "attackCurve");
    this.decay = options.decay ?? DEFAULT_DECAY;
    this.decayCurve = assertCurve(options.decayCurve ?? "exponential", "decayCurve");
    this.max = options.max ?? 1;
    this.min = options.min ?? 0;
    this.release = options.release ?? DEFAULT_RELEASE;
    this.releaseCurve = assertCurve(options.releaseCurve ?? "exponential", "releaseCurve");
    this.sustain = clamp(options.sustain ?? DEFAULT_SUSTAIN, 0, 1);
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get state(): RunState {
    return this.#state;
  }

  dispose(): void {
    this.#disposed = true;
    this.#state = "stopped";
  }

  triggerAttack(
    audioParam: AudioParam,
    time: TimeExpression = 0,
    options: EnvelopeTriggerOptions = {},
  ): AudioParam {
    const bpm = requirePositive(options.bpm ?? DEFAULT_BPM, "bpm");
    const now = options.now ?? 0;
    const startTime = resolveDuration(time, 0, { bpm, now });

    const attack = assertFiniteDuration(
      resolveDuration(this.attack, DEFAULT_ATTACK, { bpm, now }),
      "attack",
    );

    const decay = assertFiniteDuration(
      resolveDuration(this.decay, DEFAULT_DECAY, { bpm, now }),
      "decay",
    );

    const velocity = clamp(options.velocity ?? 1, 0, 1);
    const peak = this.min + (this.max - this.min) * velocity;
    const sustain = this.min + (peak - this.min) * this.sustain;
    const attackEnd = startTime + attack;
    const decayEnd = attackEnd + decay;

    const from = this.attackCurve === "exponential" ? EXPONENTIAL_FLOOR : this.min;
    cancelAndHold(audioParam, startTime);
    audioParam.setValueAtTime(from, startTime);
    this.#attacks.set(audioParam, {
      attackCurve: this.attackCurve,
      attackEnd,
      decayCurve: this.decayCurve,
      decayEnd,
      from,
      peak,
      start: startTime,
      sustain,
    });

    if (attack === 0) {
      audioParam.setValueAtTime(peak, startTime);
    } else {
      rampTo(audioParam, peak, attackEnd, this.attackCurve);
    }

    if (decay === 0) {
      audioParam.setValueAtTime(sustain, attackEnd);
    } else {
      rampTo(audioParam, sustain, decayEnd, this.decayCurve);
    }

    this.#state = "started";

    return audioParam;
  }

  triggerRelease(
    audioParam: AudioParam,
    time: TimeExpression = 0,
    options: EnvelopeTriggerOptions = {},
  ): AudioParam {
    const bpm = requirePositive(options.bpm ?? DEFAULT_BPM, "bpm");
    const now = options.now ?? 0;
    const startTime = resolveDuration(time, 0, { bpm, now });

    const release = assertFiniteDuration(
      resolveDuration(this.release, DEFAULT_RELEASE, { bpm, now }),
      "release",
    );

    const attack = this.#attacks.get(audioParam);
    cancelAndHold(
      audioParam,
      startTime,
      attack === undefined ? undefined : levelAt(attack, startTime),
    );

    if (release === 0) {
      audioParam.setValueAtTime(this.min, startTime);
      this.#state = "stopped";

      return audioParam;
    }

    rampTo(audioParam, this.min, startTime + release, this.releaseCurve);
    this.#state = "stopped";

    return audioParam;
  }

  triggerAttackRelease(
    audioParam: AudioParam,
    duration: TimeExpression,
    time: TimeExpression = 0,
    options: EnvelopeTriggerOptions = {},
  ): AudioParam {
    const bpm = requirePositive(options.bpm ?? DEFAULT_BPM, "bpm");
    const now = options.now ?? 0;
    const startTime = resolveDuration(time, 0, { bpm, now });

    const holdDuration = assertFiniteDuration(
      resolveDuration(duration, 0, { bpm, now }),
      "duration",
    );

    this.triggerAttack(audioParam, startTime, options);
    this.triggerRelease(audioParam, startTime + holdDuration, options);
    this.#state = "started";

    return audioParam;
  }
}

/**
 * Gain node whose level follows an ADSR envelope.
 */
export class AmplitudeEnvelope extends AudioNodeUnit {
  readonly envelope: Envelope;
  readonly input: GainNode;

  constructor(context: AudioContextLike, options: AmplitudeEnvelopeOptions = {}) {
    super(context);
    this.envelope = new Envelope(options);
    this.input = this.createGain(options.gain ?? this.envelope.min);
  }

  get output(): GainNode {
    return this.input;
  }

  get state(): RunState {
    return this.envelope.state;
  }

  triggerAttack(time: TimeExpression = 0, options: EnvelopeTriggerOptions = {}): this {
    this.envelope.triggerAttack(this.input.gain, time, options);

    return this;
  }

  triggerAttackRelease(
    duration: TimeExpression,
    time: TimeExpression = 0,
    options: EnvelopeTriggerOptions = {},
  ): this {
    this.envelope.triggerAttackRelease(this.input.gain, duration, time, options);

    return this;
  }

  triggerRelease(time: TimeExpression = 0, options: EnvelopeTriggerOptions = {}): this {
    this.envelope.triggerRelease(this.input.gain, time, options);

    return this;
  }

  protected override teardown(): void {
    this.envelope.dispose();
  }
}

/**
 * Constant source that sweeps from `baseFrequency` up `octaves` octaves following an ADSR
 * envelope. Connect it to a frequency param.
 */
export class FrequencyEnvelope extends AudioUnitBase implements AudioUnit {
  readonly envelope: Envelope;
  readonly output: ConstantSourceNode;
  #baseFrequency: FrequencyEnvelopeBaseFrequency;
  #exponent: number;
  #octaves: number;

  constructor(context: AudioContextLike, options: FrequencyEnvelopeOptions = {}) {
    super(context);
    this.#baseFrequency = options.baseFrequency ?? 200;
    this.#exponent = requirePositive(options.exponent ?? 1, "exponent");
    this.#octaves = requireNonNegative(options.octaves ?? 4, "octaves");
    this.envelope = new Envelope({ ...options, max: 1, min: 0 });
    this.output = this.nodes.addSource(createConstantSourceNode(this.native));
    this.#applyRange();
    this.output.start();
  }

  get baseFrequency(): FrequencyEnvelopeBaseFrequency {
    return this.#baseFrequency;
  }

  get exponent(): number {
    return this.#exponent;
  }

  get octaves(): number {
    return this.#octaves;
  }

  get state(): RunState {
    return this.envelope.state;
  }

  connect<TDestination extends AudioDestination>(destination: TDestination): TDestination {
    return connectTo(this.output, destination);
  }

  disconnect(): void {
    this.output.disconnect();
  }

  setBaseFrequency(baseFrequency: FrequencyEnvelopeBaseFrequency): void {
    this.#baseFrequency = baseFrequency;
    this.#applyRange();
  }

  setExponent(exponent: number): void {
    this.#exponent = requirePositive(exponent, "exponent");
  }

  setOctaves(octaves: number): void {
    this.#octaves = requireNonNegative(octaves, "octaves");
    this.#applyRange();
  }

  triggerAttack(time: TimeExpression = 0, options: EnvelopeTriggerOptions = {}): this {
    this.envelope.triggerAttack(this.output.offset, time, this.#scaleVelocity(options));

    return this;
  }

  triggerAttackRelease(
    duration: TimeExpression,
    time: TimeExpression = 0,
    options: EnvelopeTriggerOptions = {},
  ): this {
    this.envelope.triggerAttackRelease(
      this.output.offset,
      duration,
      time,
      this.#scaleVelocity(options),
    );

    return this;
  }

  triggerRelease(time: TimeExpression = 0, options: EnvelopeTriggerOptions = {}): this {
    this.envelope.triggerRelease(this.output.offset, time, this.#scaleVelocity(options));

    return this;
  }

  protected override teardown(): void {
    this.envelope.dispose();
  }

  #applyRange(): void {
    const base = resolveFrequency(this.#baseFrequency, "baseFrequency");
    this.envelope.min = base;
    this.envelope.max = base * 2 ** this.#octaves;
    this.output.offset.value = base;
  }

  #scaleVelocity(options: EnvelopeTriggerOptions): EnvelopeTriggerOptions {
    return { ...options, velocity: (options.velocity ?? 1) ** this.#exponent };
  }
}

/**
 * Schedules one envelope on `audioParam` that starts at `options.time` and releases `duration`
 * later. Returns `audioParam`.
 *
 * A bare `AudioParam` cannot report the context time, so `time` defaults to `options.now`, or 0
 * when that is missing too. On a running context, pass the current time, or the envelope will
 * already be over.
 */
export function applyEnvelope(
  audioParam: AudioParam,
  duration: TimeExpression,
  options: EnvelopeOptions & EnvelopeTriggerOptions & { readonly time?: TimeExpression } = {},
): AudioParam {
  const envelope = new Envelope(options);

  return envelope.triggerAttackRelease(
    audioParam,
    duration,
    options.time ?? options.now ?? 0,
    options,
  );
}
