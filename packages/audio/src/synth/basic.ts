import type { AudioContextLike } from "../context/context.ts";
import type { SynthTriggerOptions } from "./base.ts";
import type { NoteExpression, SynthOptions } from "./voice.ts";

import { createGainNode, createOscillatorNode } from "../native.ts";
import { NoteSynth } from "./base.ts";
import { Envelope } from "./envelope.ts";
import { DEFAULT_RELEASE, resolveFrequency, SynthVoice } from "./voice.ts";

/**
 * One oscillator per voice shaped by an amplitude envelope.
 */
export class Synth extends NoteSynth<SynthVoice> {
  readonly envelope: Envelope;
  readonly #options: SynthOptions;

  constructor(context: AudioContextLike, options: SynthOptions = {}) {
    super(context, options);
    this.#options = options;
    this.envelope = new Envelope({
      attack: 0.005,
      decay: 0.1,
      release: DEFAULT_RELEASE,
      sustain: 0.3,
      ...options.envelope,
    });
  }

  triggerAttack(
    note: NoteExpression,
    { time = this.immediate(), velocity = 1 }: SynthTriggerOptions = {},
  ): SynthVoice {
    const options = this.#options;
    const startTime = this.resolveTime(time);
    const gain = createGainNode(this.nativeContext, { gain: 0 });

    const oscillator = createOscillatorNode(this.nativeContext, {
      ...options.oscillator,
      detune: options.detune ?? options.oscillator?.detune ?? 0,
      frequency: resolveFrequency(note),
      type: options.oscillator?.type ?? "triangle",
    });

    oscillator.connect(gain);
    gain.connect(this.volume);
    this.envelope.triggerAttack(gain.gain, startTime, { now: this.immediate(), velocity });
    oscillator.start(startTime);

    const voice = new SynthVoice(this.context, this.voices, {
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
