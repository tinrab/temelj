import type { AudioContextLike } from "../context/context.ts";
import type { TimeExpression } from "../time/time.ts";
import type { SynthTriggerOptions } from "./base.ts";
import type { NoteExpression, SynthOptions, SynthVoiceNodes } from "./voice.ts";

import { createBiquadFilterNode, createGainNode, createOscillatorNode } from "../native.ts";
import { toNonNegativeSeconds } from "../players/playback.ts";
import { requirePositive, clampNormal } from "../validation.ts";
import { NoteSynth } from "./base.ts";
import { Envelope } from "./envelope.ts";
import { DEFAULT_RELEASE, resolveFrequency, SynthVoice } from "./voice.ts";

export type MonoSynthFilterEnvelopeOptions = {
  readonly attack?: TimeExpression;
  readonly baseFrequency?: number;
  readonly decay?: TimeExpression;
  readonly exponent?: number;
  readonly octaves?: number;
  readonly release?: TimeExpression;
  readonly sustain?: number;
};

export type MonoSynthOptions = SynthOptions & {
  readonly filter?: BiquadFilterOptions;
  readonly filterEnvelope?: MonoSynthFilterEnvelopeOptions;
  readonly portamento?: TimeExpression;
};

/**
 * Oscillator voice with a filter whose cutoff follows its own envelope.
 */
export class MonoSynthVoice extends SynthVoice {
  readonly filter: BiquadFilterNode;
  readonly #filterEnvelope: Required<MonoSynthFilterEnvelopeOptions>;
  readonly #velocity: number;

  constructor(
    context: AudioContextLike,
    owner: unknown[],
    nodes: SynthVoiceNodes & {
      readonly filter: BiquadFilterNode;
      readonly filterEnvelope: Required<MonoSynthFilterEnvelopeOptions>;
      readonly velocity: number;
    },
  ) {
    super(context, owner, nodes);
    this.filter = nodes.filter;
    this.#filterEnvelope = nodes.filterEnvelope;
    this.#velocity = nodes.velocity;
  }

  protected override releaseAt(time: number): void {
    scheduleFilterEnvelopeRelease(
      this.filter.frequency,
      this.#filterEnvelope,
      this.#velocity,
      this.startedAt,
      time,
    );
    super.releaseAt(time);
  }

  protected override teardown(now: number): void {
    super.teardown(now);
    this.filter.disconnect();
  }
}

function normalizeFilterEnvelope(
  options: MonoSynthFilterEnvelopeOptions = {},
): Required<MonoSynthFilterEnvelopeOptions> {
  return {
    attack: options.attack ?? 0.6,
    baseFrequency: requirePositive(options.baseFrequency ?? 200, "baseFrequency"),
    decay: options.decay ?? 0.2,
    exponent: requirePositive(options.exponent ?? 2, "exponent"),
    octaves: requirePositive(options.octaves ?? 3, "octaves"),
    release: options.release ?? 2,
    sustain: clampNormal(options.sustain ?? 0.5, "sustain"),
  };
}

function scheduleFilterEnvelope(
  param: AudioParam,
  envelope: Required<MonoSynthFilterEnvelopeOptions>,
  time: number,
  velocity: number,
): void {
  const attack = toNonNegativeSeconds(envelope.attack, "filterEnvelope.attack");
  const decay = toNonNegativeSeconds(envelope.decay, "filterEnvelope.decay");
  const baseFrequency = envelope.baseFrequency;
  const peakFrequency = baseFrequency * 2 ** (envelope.octaves * clampNormal(velocity, "velocity"));

  const sustainFrequency = scaleFilterEnvelopeFrequency(
    baseFrequency,
    peakFrequency,
    envelope.sustain,
    envelope.exponent,
  );

  param.cancelScheduledValues?.(time);
  param.setValueAtTime(baseFrequency, time);
  rampFilterFrequency(param, peakFrequency, time + attack);
  rampFilterFrequency(param, sustainFrequency, time + attack + decay);
}

function scheduleFilterEnvelopeRelease(
  param: AudioParam,
  envelope: Required<MonoSynthFilterEnvelopeOptions>,
  velocity: number,
  startedAt: number,
  time: number,
): void {
  const release = toNonNegativeSeconds(envelope.release, "filterEnvelope.release");

  // The release can be scheduled ahead of time, so `param.value` is not necessarily the level at `time`.
  param.cancelScheduledValues?.(time);
  param.setValueAtTime(filterFrequencyAt(envelope, velocity, startedAt, time), time);
  rampFilterFrequency(param, envelope.baseFrequency, time + release);
}

/**
 * Cutoff the attack and decay ramps reach `time` seconds after a note starts at `startedAt`.
 */
function filterFrequencyAt(
  envelope: Required<MonoSynthFilterEnvelopeOptions>,
  velocity: number,
  startedAt: number,
  time: number,
): number {
  const attack = toNonNegativeSeconds(envelope.attack, "filterEnvelope.attack");
  const decay = toNonNegativeSeconds(envelope.decay, "filterEnvelope.decay");
  const base = Math.max(envelope.baseFrequency, 1);
  const peak = Math.max(envelope.baseFrequency * 2 ** (envelope.octaves * velocity), 1);

  const sustain = Math.max(
    scaleFilterEnvelopeFrequency(base, peak, envelope.sustain, envelope.exponent),
    1,
  );

  const elapsed = time - startedAt;

  if (elapsed <= 0) {
    return base;
  }

  if (elapsed < attack) {
    return base * (peak / base) ** (elapsed / attack);
  }

  if (elapsed < attack + decay) {
    return peak * (sustain / peak) ** ((elapsed - attack) / decay);
  }

  return sustain;
}

function scaleFilterEnvelopeFrequency(
  baseFrequency: number,
  peakFrequency: number,
  sustain: number,
  exponent: number,
): number {
  const curvedSustain = sustain ** exponent;

  return baseFrequency + (peakFrequency - baseFrequency) * curvedSustain;
}

function rampFilterFrequency(param: AudioParam, value: number, time: number): void {
  param.exponentialRampToValueAtTime(Math.max(value, 1), time);
}

/**
 * Monophonic oscillator through a low-pass filter with its own envelope. Each attack replaces
 * the sounding voice.
 */
export class MonoSynth extends NoteSynth<MonoSynthVoice> {
  readonly envelope: Envelope;
  readonly filterEnvelope: Required<MonoSynthFilterEnvelopeOptions>;
  readonly portamento: TimeExpression;
  readonly #options: MonoSynthOptions;

  constructor(context: AudioContextLike, options: MonoSynthOptions = {}) {
    super(context, options);
    this.#options = options;
    this.envelope = new Envelope({
      attack: 0.005,
      decay: 0.1,
      release: DEFAULT_RELEASE,
      sustain: 0.9,
      ...options.envelope,
    });
    this.filterEnvelope = normalizeFilterEnvelope(options.filterEnvelope);
    this.portamento = options.portamento ?? 0;
  }

  triggerAttack(
    note: NoteExpression,
    { time = this.immediate(), velocity = 1 }: SynthTriggerOptions = {},
  ): MonoSynthVoice {
    const options = this.#options;
    const startTime = this.resolveTime(time);
    this.disposeVoices();

    const gain = createGainNode(this.nativeContext, { gain: 0 });

    const filter = createBiquadFilterNode(this.nativeContext, {
      Q: 1,
      frequency: this.filterEnvelope.baseFrequency,
      type: "lowpass",
      ...options.filter,
    });

    const oscillator = createOscillatorNode(this.nativeContext, {
      ...options.oscillator,
      detune: options.detune ?? options.oscillator?.detune ?? 0,
      frequency: resolveFrequency(note),
      type: options.oscillator?.type ?? "sawtooth",
    });

    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(this.volume);
    scheduleFilterEnvelope(filter.frequency, this.filterEnvelope, startTime, velocity);
    this.envelope.triggerAttack(gain.gain, startTime, { now: this.immediate(), velocity });
    oscillator.start(startTime);

    const voice = new MonoSynthVoice(this.context, this.voices, {
      envelope: this.envelope,
      filter,
      filterEnvelope: this.filterEnvelope,
      gain,
      note,
      oscillator,
      startedAt: startTime,
      velocity: clampNormal(velocity, "velocity"),
    });

    this.voices.push(voice);

    return voice;
  }
}
