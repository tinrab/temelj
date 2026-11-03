import { isString } from "@temelj/value";

import type { AudioContextLike } from "../context/context.ts";
import type { TimeExpression } from "../time/time.ts";
import type { Envelope, EnvelopeOptions } from "./envelope.ts";

import { getAudioContextImmediateTime } from "../context/context.ts";
import { stopQuietly } from "../native.ts";
import { resolveAudioTime } from "../players/playback.ts";
import { midiToFrequency, noteToFrequency } from "../time/pitch.ts";
import { toSeconds } from "../time/time.ts";
import { requirePositive } from "../validation.ts";

export type NoteExpression = number | string;

export type SynthOptions = {
  readonly detune?: number;
  readonly envelope?: EnvelopeOptions;
  readonly mute?: boolean;
  readonly oscillator?: OscillatorOptions;
  readonly volume?: number;
};

export const DEFAULT_RELEASE = 1;

/**
 * Lifecycle shared by every synth voice: release once, dispose once, then leave the owning
 * synth's voice list.
 */
export abstract class SynthVoiceBase {
  readonly startedAt: number;
  protected readonly context: AudioContextLike;
  readonly #owner: unknown[];
  #released = false;
  #disposed = false;

  constructor(context: AudioContextLike, owner: unknown[], startedAt: number) {
    this.context = context;
    this.#owner = owner;
    this.startedAt = startedAt;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  release(time?: TimeExpression): void {
    if (this.#released || this.#disposed) {
      return;
    }

    this.#released = true;
    this.releaseAt(resolveAudioTime(time ?? this.now(), this.context));
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
    this.teardown(this.now());
    removeItem(this.#owner, this);
  }

  protected now(): number {
    return getAudioContextImmediateTime(this.context);
  }

  /**
   * Disposes the voice once `source` ends. Each voice passes the source that stops when its
   * release tail is over, so finished voices leave the synth and release their nodes.
   */
  protected disposeWhenEnded(source: AudioScheduledSourceNode): void {
    source.addEventListener("ended", () => this.dispose(), { once: true });
  }

  /**
   * Schedules the release tail starting at `time`.
   */
  protected abstract releaseAt(time: number): void;

  /**
   * Stops sources and disconnects every node the voice owns.
   */
  protected abstract teardown(now: number): void;
}

export type SynthVoiceNodes = {
  readonly envelope: Envelope;
  readonly gain: GainNode;
  readonly note: NoteExpression;
  readonly oscillator: OscillatorNode;
  readonly startedAt: number;
};

/**
 * One oscillator through an envelope-controlled gain.
 */
export class SynthVoice extends SynthVoiceBase {
  readonly note: NoteExpression;
  readonly oscillator: OscillatorNode;
  protected readonly envelope: Envelope;
  protected readonly gain: GainNode;

  constructor(context: AudioContextLike, owner: unknown[], nodes: SynthVoiceNodes) {
    super(context, owner, nodes.startedAt);
    this.note = nodes.note;
    this.oscillator = nodes.oscillator;
    this.envelope = nodes.envelope;
    this.gain = nodes.gain;
    this.disposeWhenEnded(this.oscillator);
  }

  protected releaseAt(time: number): void {
    this.envelope.triggerRelease(this.gain.gain, time, { now: this.now() });
    stopQuietly(this.oscillator, time + resolveRelease(this.envelope));
  }

  protected teardown(now: number): void {
    stopQuietly(this.oscillator, now);
    this.oscillator.disconnect();
    this.gain.disconnect();
  }
}

export function resolveFrequency(note: NoteExpression): number {
  if (isString(note)) {
    return noteToFrequency(note);
  }

  if (Number.isInteger(note) && note >= 0 && note <= 127) {
    return midiToFrequency(note);
  }

  return requirePositive(note, "note");
}

export function resolveRelease(envelope: Envelope): number {
  return toSeconds(envelope.release);
}

export function isSameNote(left: NoteExpression, right: NoteExpression): boolean {
  if (isString(left) || isString(right)) {
    return String(left) === String(right);
  }

  return left === right;
}

export function normalizeNotes(
  notes: NoteExpression | readonly NoteExpression[],
): readonly NoteExpression[] {
  if (Array.isArray(notes)) {
    return notes;
  }

  // SAFETY: a value that is not an array is a single note.
  return [notes as NoteExpression];
}

export function removeItem<Item>(items: Item[], item: Item): void {
  const index = items.indexOf(item);

  if (index >= 0) {
    items.splice(index, 1);
  }
}
