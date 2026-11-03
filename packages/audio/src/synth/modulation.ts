import type { AudioContextLike } from "../context/context.ts";
import type { AMOscillatorOptions, FMOscillatorOptions } from "../source/oscillator.ts";
import type { SynthTriggerOptions } from "./base.ts";
import type { EnvelopeOptions } from "./envelope.ts";
import type { NoteExpression } from "./voice.ts";

import { createGainNode } from "../native.ts";
import { AMOscillator, FMOscillator } from "../source/oscillator.ts";
import { NoteSynth } from "./base.ts";
import { Envelope } from "./envelope.ts";
import { DEFAULT_RELEASE, resolveFrequency, resolveRelease, SynthVoiceBase } from "./voice.ts";

export type FMSynthOptions = {
  readonly envelope?: EnvelopeOptions;
  readonly mute?: boolean;
  readonly oscillator?: Omit<FMOscillatorOptions, "frequency">;
  readonly volume?: number;
};

export type AMSynthOptions = {
  readonly envelope?: EnvelopeOptions;
  readonly mute?: boolean;
  readonly oscillator?: Omit<AMOscillatorOptions, "frequency">;
  readonly volume?: number;
};

type ModulatedOscillator = AMOscillator | FMOscillator;

/**
 * Voice of an AM or FM synth: one modulated oscillator through an envelope-controlled gain.
 */
export class ModulationSynthVoice<Oscillator extends ModulatedOscillator> extends SynthVoiceBase {
  readonly note: NoteExpression;
  readonly oscillator: Oscillator;
  readonly #envelope: Envelope;
  readonly #gain: GainNode;

  constructor(
    context: AudioContextLike,
    owner: unknown[],
    nodes: {
      readonly envelope: Envelope;
      readonly gain: GainNode;
      readonly note: NoteExpression;
      readonly oscillator: Oscillator;
      readonly startedAt: number;
    },
  ) {
    super(context, owner, nodes.startedAt);
    this.note = nodes.note;
    this.oscillator = nodes.oscillator;
    this.#envelope = nodes.envelope;
    this.#gain = nodes.gain;
    this.oscillator.onEnded(() => this.dispose());
  }

  protected releaseAt(time: number): void {
    this.#envelope.triggerRelease(this.#gain.gain, time, { now: this.now() });
    this.oscillator.stop(time + resolveRelease(this.#envelope));
  }

  protected teardown(now: number): void {
    this.oscillator.stop(now);
    this.oscillator.dispose();
    this.#gain.disconnect();
  }
}

export type FMSynthVoice = ModulationSynthVoice<FMOscillator>;

export type AMSynthVoice = ModulationSynthVoice<AMOscillator>;

/**
 * Synth whose voices are AM or FM oscillators through an amplitude envelope.
 */
export abstract class ModulationSynth<Oscillator extends ModulatedOscillator> extends NoteSynth<
  ModulationSynthVoice<Oscillator>
> {
  readonly envelope: Envelope;

  constructor(context: AudioContextLike, options: AMSynthOptions | FMSynthOptions) {
    super(context, options);
    this.envelope = new Envelope({
      attack: 0.01,
      decay: 0.01,
      release: DEFAULT_RELEASE,
      sustain: 1,
      ...options.envelope,
    });
  }

  protected abstract createOscillator(frequency: number): Oscillator;

  triggerAttack(
    note: NoteExpression,
    { time = this.immediate(), velocity = 1 }: SynthTriggerOptions = {},
  ): ModulationSynthVoice<Oscillator> {
    const startTime = this.resolveTime(time);
    const oscillator = this.createOscillator(resolveFrequency(note));
    const gain = createGainNode(this.nativeContext, { gain: 0 });

    oscillator.output.connect(gain);
    gain.connect(this.volume);
    this.envelope.triggerAttack(gain.gain, startTime, { now: this.immediate(), velocity });
    oscillator.start(startTime);

    const voice = new ModulationSynthVoice(this.context, this.voices, {
      envelope: this.envelope,
      gain,
      note,
      oscillator,
      startedAt: startTime,
    });

    this.voices.push(voice);

    return voice;
  }
}

/**
 * Synth whose voices are `FMOscillator`s: a modulator oscillator modulates each carrier's
 * frequency, and the amplitude envelope shapes every note.
 */
export class FMSynth extends ModulationSynth<FMOscillator> {
  readonly #options: FMSynthOptions;

  constructor(context: AudioContextLike, options: FMSynthOptions = {}) {
    super(context, options);
    this.#options = options;
  }

  protected createOscillator(frequency: number): FMOscillator {
    return new FMOscillator(this.context, {
      harmonicity: 3,
      modulationIndex: 10,
      modulationType: "square",
      type: "sine",
      ...this.#options.oscillator,
      frequency,
    });
  }
}

/**
 * Synth whose voices are `AMOscillator`s: a modulator oscillator modulates each carrier's
 * amplitude, and the amplitude envelope shapes every note.
 */
export class AMSynth extends ModulationSynth<AMOscillator> {
  readonly #options: AMSynthOptions;

  constructor(context: AudioContextLike, options: AMSynthOptions = {}) {
    super(context, options);
    this.#options = options;
  }

  protected createOscillator(frequency: number): AMOscillator {
    return new AMOscillator(this.context, {
      harmonicity: 3,
      modulationType: "square",
      type: "sine",
      ...this.#options.oscillator,
      frequency,
    });
  }
}
