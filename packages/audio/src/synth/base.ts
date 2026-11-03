import type { AudioContextLike } from "../context/context.ts";
import type { TimeExpression } from "../time/time.ts";
import type { AudioDestination, AudioUnit, RunState } from "../unit.ts";
import type { NoteExpression } from "./voice.ts";

import { getAudioContextImmediateTime, getNativeAudioContext } from "../context/context.ts";
import { connectTo, createGainNode } from "../native.ts";
import { resolveAudioTime } from "../players/playback.ts";
import { toSeconds } from "../time/time.ts";
import { requireNonNegative } from "../validation.ts";
import { isSameNote } from "./voice.ts";

export type SynthOutputOptions = {
  readonly mute?: boolean;
  /**
   * Output gain (linear).
   */
  readonly volume?: number;
};

/**
 * Minimal voice contract the synth shell needs to track and dispose voices.
 */
export type TrackedVoice = {
  readonly disposed: boolean;
  dispose(): void;
};

/**
 * Shared shell for synths: owns the output gain and the list of active voices. Subclasses add their
 * trigger methods and voice graphs.
 *
 * Voices remove themselves from `voices` when they finish, so subclasses pass the list to their
 * voice factories.
 */
export abstract class SynthBase<Voice extends TrackedVoice> implements AudioUnit {
  protected readonly context: AudioContextLike;
  protected readonly nativeContext: BaseAudioContext;
  protected readonly voices: Voice[] = [];
  readonly volume: GainNode;
  #mute: boolean;
  #level: number;
  #disposed = false;

  constructor(context: AudioContextLike, options: SynthOutputOptions = {}) {
    this.context = context;
    this.nativeContext = getNativeAudioContext(context);
    this.#mute = options.mute === true;
    this.#level = requireNonNegative(options.volume ?? 1, "volume");
    this.volume = createGainNode(this.nativeContext, { gain: this.#mute ? 0 : this.#level });
  }

  get output(): GainNode {
    return this.volume;
  }

  get activeVoices(): readonly Voice[] {
    return [...this.voices];
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get state(): RunState {
    return this.voices.length > 0 ? "started" : "stopped";
  }

  get mute(): boolean {
    return this.#mute;
  }

  connect<Destination extends AudioDestination>(destination: Destination): Destination {
    return connectTo(this.volume, destination);
  }

  disconnect(): void {
    this.volume.disconnect();
  }

  setMute(mute: boolean, time?: TimeExpression): void {
    this.#mute = mute;
    this.#applyOutputGain(time);
  }

  setVolume(volume: number, time?: TimeExpression): void {
    this.#level = requireNonNegative(volume, "volume");
    this.#applyOutputGain(time);
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
    this.disposeVoices();
    this.volume.disconnect();
  }

  /**
   * Current native time, the default for trigger methods.
   */
  protected immediate(): number {
    return getAudioContextImmediateTime(this.context);
  }

  protected resolveTime(time: TimeExpression): number {
    return resolveAudioTime(time, this.context);
  }

  protected disposeVoices(): void {
    for (const voice of Array.from(this.voices)) {
      voice.dispose();
    }

    this.voices.length = 0;
  }

  #applyOutputGain(time: TimeExpression | undefined): void {
    this.volume.gain.setValueAtTime(
      this.#mute ? 0 : this.#level,
      this.resolveTime(time ?? this.immediate()),
    );
  }
}

export type SynthTriggerOptions = {
  /**
   * When to start. Defaults to the current native time.
   */
  readonly time?: TimeExpression;
  /**
   * Peak level in [0, 1]. Defaults to 1.
   */
  readonly velocity?: number;
};

export type SynthReleaseOptions = {
  readonly time?: TimeExpression;
};

/**
 * Voice played at a note, released at a time.
 */
export type NoteVoice = TrackedVoice & {
  readonly note: NoteExpression;
  release(time?: TimeExpression): void;
};

/**
 * Synth whose voices are started per note. Subclasses implement `triggerAttack`.
 */
export abstract class NoteSynth<Voice extends NoteVoice> extends SynthBase<Voice> {
  abstract triggerAttack(note: NoteExpression, options?: SynthTriggerOptions): Voice;

  triggerAttackRelease(
    note: NoteExpression,
    duration: TimeExpression,
    { time = this.immediate(), velocity = 1 }: SynthTriggerOptions = {},
  ): Voice {
    const voice = this.triggerAttack(note, { time, velocity });
    voice.release(this.resolveTime(time) + toSeconds(duration));

    return voice;
  }

  /**
   * Releases every voice playing `note`, or every voice when `note` is omitted.
   */
  triggerRelease(
    note?: NoteExpression,
    { time = this.immediate() }: SynthReleaseOptions = {},
  ): void {
    for (const voice of Array.from(this.voices)) {
      if (note === undefined || isSameNote(voice.note, note)) {
        voice.release(time);
      }
    }
  }
}
