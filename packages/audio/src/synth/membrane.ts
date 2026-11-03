import type { AudioContextLike } from "../context/context.ts";
import type { TimeExpression } from "../time/time.ts";
import type { SynthTriggerOptions } from "./base.ts";
import type { NoteExpression, SynthOptions } from "./voice.ts";

import { createGainNode, createOscillatorNode } from "../native.ts";
import { toNonNegativeSeconds } from "../players/playback.ts";
import { requirePositive } from "../validation.ts";
import { NoteSynth } from "./base.ts";
import { Envelope } from "./envelope.ts";
import { resolveFrequency, SynthVoice } from "./voice.ts";

export type MembraneSynthOptions = SynthOptions & {
  readonly octaves?: number;
  readonly pitchDecay?: TimeExpression;
};

/**
 * Kick-drum style synth: a sine that sweeps down `octaves` to the note over `pitchDecay`.
 */
export class MembraneSynth extends NoteSynth<SynthVoice> {
  readonly envelope: Envelope;
  readonly octaves: number;
  readonly pitchDecay: TimeExpression;
  readonly #options: MembraneSynthOptions;

  constructor(context: AudioContextLike, options: MembraneSynthOptions = {}) {
    super(context, options);
    this.#options = options;
    this.envelope = new Envelope({
      attack: 0.001,
      attackCurve: "exponential",
      decay: 0.4,
      release: 1.4,
      sustain: 0.01,
      ...options.envelope,
    });
    this.octaves = requirePositive(options.octaves ?? 8, "octaves");
    this.pitchDecay = options.pitchDecay ?? 0.05;
  }

  triggerAttack(
    note: NoteExpression,
    { time = this.immediate(), velocity = 1 }: SynthTriggerOptions = {},
  ): SynthVoice {
    const options = this.#options;
    const startTime = this.resolveTime(time);
    const frequency = resolveFrequency(note);
    const startFrequency = frequency * 2 ** this.octaves;
    const gain = createGainNode(this.nativeContext, { gain: 0 });

    const oscillator = createOscillatorNode(this.nativeContext, {
      ...options.oscillator,
      detune: options.detune ?? options.oscillator?.detune ?? 0,
      frequency: startFrequency,
      type: options.oscillator?.type ?? "sine",
    });

    oscillator.connect(gain);
    gain.connect(this.volume);
    oscillator.frequency.setValueAtTime(startFrequency, startTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      frequency,
      startTime + toNonNegativeSeconds(this.pitchDecay, "pitchDecay"),
    );
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
