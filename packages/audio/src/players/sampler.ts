import { isString } from "@temelj/value";

import type { AudioSourceInput } from "../buffer/loading.ts";
import type { AudioContextLike } from "../context/context.ts";
import type { SynthReleaseOptions, SynthTriggerOptions } from "../synth/base.ts";
import type { NoteExpression } from "../synth/voice.ts";
import type { TimeExpression } from "../time/time.ts";
import type { FadeCurve, RunState } from "../unit.ts";

import { resolveAudioBuffer } from "../buffer/source.ts";
import { AudioGraphError, AudioRangeError } from "../errors.ts";
import { normalizeNotes } from "../synth/voice.ts";
import { intervalToFrequencyRatio, noteToMidi } from "../time/pitch.ts";
import { toSeconds } from "../time/time.ts";
import { clampNormal, requireInRange } from "../validation.ts";
import { BufferVoice, OutputUnit, requireFadeCurve, toNonNegativeSeconds } from "./playback.ts";

export type SamplerOptions = {
  readonly attack?: TimeExpression;
  readonly baseUrl?: string | URL;
  readonly curve?: FadeCurve;
  /**
   * Sustain notes by repeating `loopStart`–`loopEnd` after the sample's attack, until release.
   */
  readonly loop?: boolean;
  readonly loopEnd?: TimeExpression;
  readonly loopStart?: TimeExpression;
  readonly mute?: boolean;
  /**
   * Called once per voice when it is released or ends.
   */
  readonly onStop?: (voice: SamplerVoice) => void;
  readonly release?: TimeExpression;
  readonly volume?: number;
};

/**
 * Voice playing the closest loaded sample, repitched to `midi`.
 */
export class SamplerVoice extends BufferVoice {
  readonly midi: number;
  readonly sampleMidi: number;
  readonly #release: number;

  constructor(
    context: AudioContextLike,
    owner: unknown[],
    sampler: {
      readonly buffer: AudioBuffer;
      readonly curve: FadeCurve;
      readonly destination: AudioNode;
      readonly loop: boolean;
      readonly loopEnd: number | undefined;
      readonly loopStart: number;
      readonly midi: number;
      readonly onStop: ((voice: SamplerVoice) => void) | undefined;
      readonly release: number;
      readonly sampleMidi: number;
    },
  ) {
    super(
      context,
      owner,
      {
        buffer: sampler.buffer,
        destination: sampler.destination,
        fadeCurve: sampler.curve,
        loop: sampler.loop,
        loopEnd: sampler.loopEnd,
        loopStart: sampler.loopStart,
        playbackRate: intervalToFrequencyRatio(sampler.midi - sampler.sampleMidi),
      },
      // SAFETY: `BufferVoice` passes back the voice it was constructed as.
      sampler.onStop as ((voice: BufferVoice) => void) | undefined,
    );
    this.midi = sampler.midi;
    this.sampleMidi = sampler.sampleMidi;
    this.#release = sampler.release;
  }

  /**
   * Fades out over the sampler release time.
   */
  release(time?: number): void {
    this.stop(time, this.#release);
  }
}

/**
 * Plays notes from a set of samples, repitching the closest sample for each note.
 */
export class Sampler extends OutputUnit {
  readonly #baseUrl: string | URL | undefined;
  readonly #samples = new Map<number, AudioBuffer>();
  readonly #voices: SamplerVoice[] = [];
  readonly #onStop: ((voice: SamplerVoice) => void) | undefined;
  #attack: number;
  #curve: FadeCurve;
  #loop: boolean;
  #loopStart: number;
  #loopEnd: number | undefined;
  #release: number;

  constructor(context: AudioContextLike, options: SamplerOptions = {}) {
    super(context, options);
    this.#baseUrl = options.baseUrl;
    this.#onStop = options.onStop;
    this.#attack = toNonNegativeSeconds(options.attack ?? 0, "attack");
    this.#curve = requireFadeCurve(options.curve ?? "exponential");
    this.#loop = options.loop === true;
    this.#loopStart = toNonNegativeSeconds(options.loopStart ?? 0, "loopStart");
    this.#loopEnd =
      options.loopEnd === undefined ? undefined : toNonNegativeSeconds(options.loopEnd, "loopEnd");
    this.#release = toNonNegativeSeconds(options.release ?? 0.1, "release");
  }

  /**
   * Creates a sampler and loads `samples`, keyed by note name or MIDI number.
   */
  static async load(
    context: AudioContextLike,
    samples: Readonly<Record<string, AudioSourceInput>>,
    options: SamplerOptions = {},
  ): Promise<Sampler> {
    const sampler = new Sampler(context, options);
    await Promise.all(Object.entries(samples).map(([note, source]) => sampler.add(note, source)));

    return sampler;
  }

  get activeVoices(): readonly SamplerVoice[] {
    return [...this.#voices];
  }

  get attack(): number {
    return this.#attack;
  }

  get curve(): FadeCurve {
    return this.#curve;
  }

  get loop(): boolean {
    return this.#loop;
  }

  get loopStart(): number {
    return this.#loopStart;
  }

  get loopEnd(): number | undefined {
    return this.#loopEnd;
  }

  get release(): number {
    return this.#release;
  }

  /**
   * Loaded sample notes as sorted MIDI numbers.
   */
  get sampleNotes(): readonly number[] {
    return [...this.#samples.keys()].toSorted((left, right) => left - right);
  }

  get state(): RunState {
    return this.#voices.length > 0 ? "started" : "stopped";
  }

  async add(note: NoteExpression, source: AudioSourceInput): Promise<void> {
    const midi = toMidi(note);
    const buffer = await resolveAudioBuffer(this.context, source, { baseUrl: this.#baseUrl });
    requireLoopPointInBuffer(this.#loopStart, buffer, "loopStart");
    requireLoopPointInBuffer(this.#loopEnd, buffer, "loopEnd");
    this.#samples.set(midi, buffer);
  }

  triggerAttack(
    notes: NoteExpression | readonly NoteExpression[],
    { time, velocity = 1 }: SynthTriggerOptions = {},
  ): readonly SamplerVoice[] {
    const startTime = this.resolveTime(time);

    return normalizeNotes(notes).map((note) => {
      const midi = toMidi(note);
      const [sampleMidi, buffer] = this.#closestSample(midi);

      const voice = new SamplerVoice(this.context, this.#voices, {
        buffer,
        curve: this.#curve,
        destination: this.output,
        loop: this.#loop,
        loopEnd: this.#loopEnd,
        loopStart: this.#loopStart,
        midi,
        onStop: this.#onStop,
        release: this.#release,
        sampleMidi,
      });

      this.#voices.push(voice);
      voice.start({
        // Play the attack from the start of the sample; when looping, the source then repeats
        // the loop region until the note is released.
        duration: this.#loop ? undefined : buffer.duration,
        fadeIn: this.#attack,
        gain: clampNormal(velocity, "velocity"),
        offset: 0,
        time: startTime,
      });

      return voice;
    });
  }

  /**
   * Starts `notes` and releases each after its duration. An array of durations pairs with an
   * array of notes; the last duration repeats.
   */
  triggerAttackRelease(
    notes: NoteExpression | readonly NoteExpression[],
    duration: TimeExpression | readonly TimeExpression[],
    options: SynthTriggerOptions = {},
  ): readonly SamplerVoice[] {
    if (Array.isArray(duration) && !Array.isArray(notes)) {
      AudioRangeError.invalidOption("duration", duration);
    }

    const startTime = this.resolveTime(options.time);
    const voices = this.triggerAttack(notes, { ...options, time: startTime });
    const durations: readonly TimeExpression[] = Array.isArray(duration) ? duration : [duration];
    voices.forEach((voice, index) => {
      const hold = durations[Math.min(index, durations.length - 1)] ?? 0;
      voice.release(startTime + toSeconds(hold));
    });

    return voices;
  }

  /**
   * Releases voices playing `notes`, or every voice when `notes` is omitted.
   */
  triggerRelease(
    notes?: NoteExpression | readonly NoteExpression[],
    { time }: SynthReleaseOptions = {},
  ): void {
    const targets = notes === undefined ? undefined : normalizeNotes(notes).map(toMidi);
    const releaseTime = this.resolveTime(time);

    for (const voice of Array.from(this.#voices)) {
      if (targets === undefined || targets.includes(voice.midi)) {
        voice.release(releaseTime);
      }
    }
  }

  setAttack(attack: TimeExpression): void {
    this.#attack = toNonNegativeSeconds(attack, "attack");
  }

  setCurve(curve: FadeCurve): void {
    this.#curve = requireFadeCurve(curve);
  }

  setLoop(loop: boolean): void {
    this.#loop = loop;

    for (const voice of this.#voices) {
      voice.source.loop = loop;
    }
  }

  setLoopPoints(loopStart: TimeExpression, loopEnd: TimeExpression): void {
    const start = toNonNegativeSeconds(loopStart, "loopStart");
    const end = toNonNegativeSeconds(loopEnd, "loopEnd");

    for (const buffer of this.#samples.values()) {
      requireLoopPointInBuffer(start, buffer, "loopStart");
      requireLoopPointInBuffer(end, buffer, "loopEnd");
    }

    this.#loopStart = start;
    this.#loopEnd = end;

    for (const voice of this.#voices) {
      voice.source.loopStart = start;
      voice.source.loopEnd = end;
    }
  }

  setRelease(release: TimeExpression): void {
    this.#release = toNonNegativeSeconds(release, "release");
  }

  protected override teardown(): void {
    for (const voice of Array.from(this.#voices)) {
      voice.dispose();
    }

    this.#samples.clear();
  }

  #closestSample(midi: number): readonly [number, AudioBuffer] {
    let closest: readonly [number, AudioBuffer] | undefined;

    for (const entry of this.#samples) {
      if (closest === undefined || Math.abs(entry[0] - midi) < Math.abs(closest[0] - midi)) {
        closest = entry;
      }
    }

    return closest ?? AudioGraphError.missingResource("sample", String(midi));
  }
}

/**
 * Converts a note name or numeric string to a MIDI number, rounded to an integer. Numbers pass
 * through the same range check.
 *
 * @throws {AudioRangeError} When the note is outside MIDI range (0–127).
 */
function toMidi(note: NoteExpression): number {
  const midi =
    isString(note) && String(Number.parseFloat(note)) === note.trim()
      ? Number.parseFloat(note)
      : isString(note)
        ? noteToMidi(note)
        : note;

  return Math.round(requireInRange(midi, 0, 127, "note"));
}

function requireLoopPointInBuffer(
  value: number | undefined,
  buffer: AudioBuffer,
  name: string,
): void {
  if (value !== undefined) {
    requireInRange(value, 0, buffer.duration, name);
  }
}
