import type { AudioContextLike } from "../context/context.ts";
import type { TimeExpression } from "../time/time.ts";
import type { RunState } from "../unit.ts";
import type { SynthReleaseOptions, SynthTriggerOptions } from "./base.ts";
import type { NoteExpression, SynthVoice } from "./voice.ts";
import type { SynthOptions } from "./voice.ts";

import { AudioRangeError } from "../errors.ts";
import { requirePositiveInteger } from "../validation.ts";
import { SynthBase } from "./base.ts";
import { Synth } from "./basic.ts";
import { isSameNote, normalizeNotes } from "./voice.ts";
import { removeItem } from "./voice.ts";

export type PolySynthOptions = SynthOptions & {
  readonly maxPolyphony?: number;
};

/**
 * Plays each note on its own `Synth`, stealing the oldest voice beyond `maxPolyphony`.
 */
export class PolySynth extends SynthBase<SynthVoice> {
  readonly maxPolyphony: number;
  readonly #options: PolySynthOptions;
  readonly #synths = new WeakMap<SynthVoice, Synth>();
  readonly #released = new WeakSet<SynthVoice>();

  constructor(context: AudioContextLike, options: PolySynthOptions = {}) {
    super(context, options);
    this.#options = options;
    this.maxPolyphony = requirePositiveInteger(options.maxPolyphony ?? 32, "maxPolyphony");
  }

  override dispose(): void {
    if (this.disposed) {
      return;
    }

    for (const voice of this.voices) {
      this.#synths.get(voice)?.dispose();
    }

    super.dispose();
  }

  override get activeVoices(): readonly SynthVoice[] {
    this.#pruneFinished();

    return super.activeVoices;
  }

  override get state(): RunState {
    this.#pruneFinished();

    return super.state;
  }

  releaseAll({ time }: SynthReleaseOptions = {}): void {
    for (const voice of Array.from(this.voices)) {
      this.#release(voice, time);
    }
  }

  triggerAttack(
    notes: NoteExpression | readonly NoteExpression[],
    options: SynthTriggerOptions = {},
  ): readonly SynthVoice[] {
    return normalizeNotes(notes).map((note) =>
      this.#play((synth) => synth.triggerAttack(note, options)),
    );
  }

  triggerAttackRelease(
    notes: NoteExpression | readonly NoteExpression[],
    duration: TimeExpression | readonly TimeExpression[],
    options: SynthTriggerOptions = {},
  ): readonly SynthVoice[] {
    const durations: readonly TimeExpression[] | undefined = Array.isArray(duration)
      ? duration
      : undefined;

    if (durations !== undefined && !Array.isArray(notes)) {
      return AudioRangeError.invalidOption("duration", "array with a single note");
    }

    return normalizeNotes(notes).map((note, index) => {
      const hold = durations?.[Math.min(index, durations.length - 1)] ?? duration;

      // SAFETY: `hold` is a single duration: either one array entry or the non-array duration.
      return this.#play((synth) =>
        synth.triggerAttackRelease(note, hold as TimeExpression, options),
      );
    });
  }

  /**
   * Releases the first unreleased voice for each note, or every voice when `notes` is omitted.
   */
  triggerRelease(
    notes?: NoteExpression | readonly NoteExpression[],
    { time }: SynthReleaseOptions = {},
  ): void {
    if (notes === undefined) {
      for (const voice of Array.from(this.voices)) {
        if (!this.#released.has(voice)) {
          this.#release(voice, time);
        }
      }

      return;
    }

    for (const note of normalizeNotes(notes)) {
      const voice = this.voices.find(
        (active) => !this.#released.has(active) && isSameNote(active.note, note),
      );

      if (voice !== undefined) {
        this.#release(voice, time);
      }
    }
  }

  #play(start: (synth: Synth) => SynthVoice): SynthVoice {
    this.#pruneFinished();
    this.#stealVoices();
    const { maxPolyphony: _maxPolyphony, ...voiceOptions } = this.#options;
    const synth = new Synth(this.context, { ...voiceOptions, mute: false, volume: 1 });
    synth.connect(this.volume);
    const voice = start(synth);
    this.voices.push(voice);
    this.#synths.set(voice, synth);

    return voice;
  }

  #release(voice: SynthVoice, time: TimeExpression | undefined): void {
    this.#released.add(voice);
    voice.release(time);
  }

  /**
   * Each voice disposes itself when its release ends, which removes it from its own synth but not
   * from this list. Drops those voices and the synths that played them.
   */
  #pruneFinished(): void {
    for (const voice of Array.from(this.voices)) {
      if (voice.disposed) {
        removeItem(this.voices, voice);
        this.#synths.get(voice)?.dispose();
      }
    }
  }

  #stealVoices(): void {
    while (this.voices.length >= this.maxPolyphony) {
      const oldest = this.voices[0];

      if (oldest === undefined) {
        return;
      }

      oldest.dispose();
      removeItem(this.voices, oldest);
      this.#synths.get(oldest)?.dispose();
    }
  }
}
