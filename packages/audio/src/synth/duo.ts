import type { AudioContextLike } from "../context/context.ts";
import type { TimeExpression } from "../time/time.ts";
import type { SynthTriggerOptions } from "./base.ts";
import type { MonoSynthOptions, MonoSynthVoice } from "./mono.ts";
import type { NoteExpression } from "./voice.ts";

import { createGainNode, createOscillatorNode, stopQuietly } from "../native.ts";
import { clampNormal, requireFinite, requirePositive } from "../validation.ts";
import { NoteSynth } from "./base.ts";
import { MonoSynth } from "./mono.ts";
import { resolveFrequency, SynthVoiceBase } from "./voice.ts";

export type DuoSynthOptions = {
  readonly detune?: number;
  readonly harmonicity?: number;
  readonly vibratoAmount?: number;
  readonly vibratoRate?: number;
  readonly voice0?: MonoSynthOptions;
  readonly voice1?: MonoSynthOptions;
  readonly volume?: number;
};

/**
 * Pair of mono voices started and released together.
 */
export class DuoSynthVoice extends SynthVoiceBase {
  readonly note: NoteExpression;
  readonly voice0: MonoSynthVoice;
  readonly voice1: MonoSynthVoice;

  constructor(
    context: AudioContextLike,
    owner: unknown[],
    voices: {
      readonly note: NoteExpression;
      readonly startedAt: number;
      readonly voice0: MonoSynthVoice;
      readonly voice1: MonoSynthVoice;
    },
  ) {
    super(context, owner, voices.startedAt);
    this.note = voices.note;
    this.voice0 = voices.voice0;
    this.voice1 = voices.voice1;
    // Both inner voices stop at the same time; the first one ending marks the end of this one.
    this.disposeWhenEnded(this.voice0.oscillator);
  }

  protected releaseAt(time: number): void {
    this.voice0.release(time);
    this.voice1.release(time);
  }

  protected teardown(): void {
    this.voice0.dispose();
    this.voice1.dispose();
  }
}

/**
 * Vibrato depth at full amount, in cents.
 */
const VIBRATO_CENTS = 50;

/**
 * Two mono synths a harmonicity ratio apart, sharing a vibrato LFO.
 */
export class DuoSynth extends NoteSynth<DuoSynthVoice> {
  readonly voice0: MonoSynth;
  readonly voice1: MonoSynth;
  readonly vibrato: OscillatorNode;
  readonly vibratoDepth: GainNode;
  #detune: number;
  #harmonicity: number;
  #vibratoStarted = false;

  constructor(context: AudioContextLike, options: DuoSynthOptions = {}) {
    super(context, options);
    this.voice0 = new MonoSynth(context, createDuoVoiceOptions(options.voice0));
    this.voice1 = new MonoSynth(context, createDuoVoiceOptions(options.voice1));
    this.vibrato = createOscillatorNode(this.nativeContext, {
      frequency: requirePositive(options.vibratoRate ?? 5, "vibratoRate"),
      type: "sine",
    });
    this.vibratoDepth = createGainNode(this.nativeContext, {
      gain: clampNormal(options.vibratoAmount ?? 0.5, "vibratoAmount") * VIBRATO_CENTS,
    });
    this.#detune = requireFinite(options.detune ?? 0, "detune");
    this.#harmonicity = requirePositive(options.harmonicity ?? 1.5, "harmonicity");
    this.voice0.connect(this.volume);
    this.voice1.connect(this.volume);
    this.vibrato.connect(this.vibratoDepth);
  }

  get detune(): number {
    return this.#detune;
  }

  get harmonicity(): number {
    return this.#harmonicity;
  }

  get vibratoAmount(): AudioParam {
    return this.vibratoDepth.gain;
  }

  get vibratoRate(): AudioParam {
    return this.vibrato.frequency;
  }

  override dispose(): void {
    if (this.disposed) {
      return;
    }

    super.dispose();
    this.voice0.dispose();
    this.voice1.dispose();
    this.vibrato.disconnect();
    this.vibratoDepth.disconnect();

    if (this.#vibratoStarted) {
      stopQuietly(this.vibrato, this.immediate());
      this.#vibratoStarted = false;
    }
  }

  setDetune(detune: number, time: TimeExpression = this.immediate()): void {
    this.#detune = requireFinite(detune, "detune");
    const at = this.resolveTime(time);

    for (const voice of this.voices) {
      voice.voice0.oscillator.detune.setValueAtTime(this.#detune, at);
      voice.voice1.oscillator.detune.setValueAtTime(this.#detune, at);
    }
  }

  setHarmonicity(harmonicity: number): void {
    this.#harmonicity = requirePositive(harmonicity, "harmonicity");
  }

  setVibratoAmount(amount: number, time: TimeExpression = this.immediate()): void {
    this.vibratoDepth.gain.setValueAtTime(
      clampNormal(amount, "amount") * VIBRATO_CENTS,
      this.resolveTime(time),
    );
  }

  setVibratoRate(rate: number, time: TimeExpression = this.immediate()): void {
    this.vibrato.frequency.setValueAtTime(
      requirePositive(rate, "vibratoRate"),
      this.resolveTime(time),
    );
  }

  triggerAttack(
    note: NoteExpression,
    { time = this.immediate(), velocity = 1 }: SynthTriggerOptions = {},
  ): DuoSynthVoice {
    const startTime = this.resolveTime(time);

    const voice = new DuoSynthVoice(this.context, this.voices, {
      note,
      startedAt: startTime,
      voice0: this.voice0.triggerAttack(note, { time: startTime, velocity }),
      voice1: this.voice1.triggerAttack(resolveFrequency(note) * this.#harmonicity, {
        time: startTime,
        velocity,
      }),
    });

    voice.voice0.oscillator.detune.setValueAtTime(this.#detune, startTime);
    voice.voice1.oscillator.detune.setValueAtTime(this.#detune, startTime);
    this.vibratoDepth.connect(voice.voice0.oscillator.detune);
    this.vibratoDepth.connect(voice.voice1.oscillator.detune);

    if (!this.#vibratoStarted) {
      this.vibrato.start(startTime);
      this.#vibratoStarted = true;
    }

    this.voices.push(voice);

    return voice;
  }
}

function createDuoVoiceOptions(options: MonoSynthOptions | undefined): MonoSynthOptions {
  return {
    envelope: {
      attack: 0.01,
      decay: 0,
      release: 0.5,
      sustain: 1,
      ...options?.envelope,
    },
    filterEnvelope: {
      attack: 0.01,
      decay: 0,
      release: 0.5,
      sustain: 1,
      ...options?.filterEnvelope,
    },
    ...options,
    volume: 1,
  };
}
