import { isString } from "@temelj/value";

import { AudioRangeError } from "../errors.ts";
import { requireFinite, requirePositive } from "../validation.ts";

export type MidiToFrequencyOptions = {
  readonly referenceFrequency?: number;
  readonly referenceMidi?: number;
};

export type FrequencyToMidiOptions = {
  readonly referenceFrequency?: number;
  readonly referenceMidi?: number;
};

export type IntervalRatioOptions = {
  readonly divisions?: number;
};

export type FrequencyRatioToCentsOptions = {
  readonly divisions?: number;
};

export type NoteToMidiOptions = {
  readonly middleCOctave?: number;
};

export type MidiToNoteOptions = {
  readonly accidental?: "flat" | "sharp";
  readonly middleCOctave?: number;
};

export type FrequencyToNoteOptions = FrequencyToMidiOptions & MidiToNoteOptions;

const DEFAULT_REFERENCE_FREQUENCY = 440;

const DEFAULT_REFERENCE_MIDI = 69;

const DEFAULT_DIVISIONS = 12;

const DEFAULT_MIDDLE_C_OCTAVE = 4;

const NOTE_NAME_PATTERN = /^([A-Ga-g])([#bx]*)(-?\d+)$/;

const NOTE_OFFSETS = new Map<string, number>([
  ["C", 0],
  ["D", 2],
  ["E", 4],
  ["F", 5],
  ["G", 7],
  ["A", 9],
  ["B", 11],
]);

const SHARP_NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const FLAT_NOTE_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function accidentalOffset(accidental: string): number {
  let offset = 0;

  for (const symbol of accidental) {
    if (symbol === "#") {
      offset += 1;
    } else if (symbol === "b") {
      offset -= 1;
    } else if (symbol === "x") {
      offset += 2;
    } else {
      AudioRangeError.invalidOption("note accidental", symbol);
    }
  }

  return offset;
}

/**
 * Returns the frequency ratio of `interval` steps in an equal temperament of `options.divisions`
 * steps per octave (12 by default).
 */
export function intervalToFrequencyRatio(
  interval: number,
  options: IntervalRatioOptions = {},
): number {
  const divisions = requirePositive(options.divisions ?? DEFAULT_DIVISIONS, "divisions");

  return 2 ** (requireFinite(interval, "interval") / divisions);
}

/**
 * Returns the frequency ratio of `cents` (100 cents per semitone).
 */
export function centsToFrequencyRatio(cents: number): number {
  return intervalToFrequencyRatio(requireFinite(cents, "cents") / 100);
}

/**
 * Returns the size of a frequency ratio in cents, counting 100 cents per step of an equal
 * temperament with `options.divisions` steps per octave (12 by default).
 */
export function frequencyRatioToCents(
  ratio: number,
  options: FrequencyRatioToCentsOptions = {},
): number {
  const divisions = requirePositive(options.divisions ?? DEFAULT_DIVISIONS, "divisions");

  return divisions * 100 * Math.log2(requirePositive(ratio, "ratio"));
}

/**
 * Returns the frequency in hertz of a MIDI note number, by default with A4 (69) at 440 Hz.
 * Fractional notes are allowed.
 */
export function midiToFrequency(midi: number, options: MidiToFrequencyOptions = {}): number {
  const referenceFrequency = requirePositive(
    options.referenceFrequency ?? DEFAULT_REFERENCE_FREQUENCY,
    "referenceFrequency",
  );

  const referenceMidi = requireFinite(
    options.referenceMidi ?? DEFAULT_REFERENCE_MIDI,
    "referenceMidi",
  );

  const value = requireFinite(midi, "midi");

  return referenceFrequency * intervalToFrequencyRatio(value - referenceMidi);
}

/**
 * Returns the fractional MIDI note number of `frequency` in hertz, by default with A4 (69) at 440
 * Hz.
 */
export function frequencyToMidi(frequency: number, options: FrequencyToMidiOptions = {}): number {
  const referenceFrequency = requirePositive(
    options.referenceFrequency ?? DEFAULT_REFERENCE_FREQUENCY,
    "referenceFrequency",
  );

  const referenceMidi = requireFinite(
    options.referenceMidi ?? DEFAULT_REFERENCE_MIDI,
    "referenceMidi",
  );

  const value = requirePositive(frequency, "frequency");

  return referenceMidi + DEFAULT_DIVISIONS * Math.log2(value / referenceFrequency);
}

/**
 * Returns the MIDI note number closest to `frequency` in hertz.
 */
export function frequencyToNearestMidi(
  frequency: number,
  options: FrequencyToMidiOptions = {},
): number {
  return Math.round(frequencyToMidi(frequency, options));
}

/**
 * Returns whether `value` is a scientific pitch name such as `F#3` or `Bb-1`.
 */
export function isNoteName(value: unknown): value is string {
  return isString(value) && NOTE_NAME_PATTERN.test(value.trim());
}

/**
 * Returns the MIDI note number of a pitch name such as `C4`. Middle C is in octave 4 by default
 * (`options.middleCOctave`).
 *
 * @throws {AudioRangeError} When `note` is not a pitch name.
 */
export function noteToMidi(note: string, options: NoteToMidiOptions = {}): number {
  const match = NOTE_NAME_PATTERN.exec(note.trim());

  if (match === null) {
    return AudioRangeError.invalidOption("note", note);
  }

  const [, letterText = "", accidental = "", octaveText = ""] = match;
  const letter = letterText.toUpperCase();
  const octave = Number.parseInt(octaveText, 10);
  const offset = NOTE_OFFSETS.get(letter);

  if (offset === undefined) {
    return AudioRangeError.invalidOption("note letter", letter);
  }

  const middleCOctave = options.middleCOctave ?? DEFAULT_MIDDLE_C_OCTAVE;

  return 60 + (octave - middleCOctave) * DEFAULT_DIVISIONS + offset + accidentalOffset(accidental);
}

/**
 * Returns the frequency in hertz of a pitch name such as `A4`.
 *
 * @throws {AudioRangeError} When `note` is not a pitch name.
 */
export function noteToFrequency(
  note: string,
  options: NoteToMidiOptions & MidiToFrequencyOptions = {},
): number {
  return midiToFrequency(noteToMidi(note, options), options);
}

/**
 * Returns the pitch name of the nearest MIDI note, spelled with sharps by default
 * (`options.accidental`).
 */
export function midiToNote(midi: number, options: MidiToNoteOptions = {}): string {
  const value = Math.round(requireFinite(midi, "midi"));
  const middleCOctave = options.middleCOctave ?? DEFAULT_MIDDLE_C_OCTAVE;
  const names = options.accidental === "flat" ? FLAT_NOTE_NAMES : SHARP_NOTE_NAMES;
  const noteIndex = mod(value, DEFAULT_DIVISIONS);
  const octave = middleCOctave + Math.floor((value - 60) / DEFAULT_DIVISIONS);

  return `${names[noteIndex]}${octave}`;
}

/**
 * Returns the pitch name nearest to `frequency` in hertz.
 */
export function frequencyToNote(frequency: number, options: FrequencyToNoteOptions = {}): string {
  return midiToNote(frequencyToMidi(frequency, options), options);
}

/**
 * Returns `frequency` shifted by `interval` semitones.
 */
export function transposeFrequency(frequency: number, interval: number): number {
  return requirePositive(frequency, "frequency") * intervalToFrequencyRatio(interval);
}

/**
 * Returns `frequency` shifted by each of `intervals` (semitones).
 */
export function harmonizeFrequency(frequency: number, intervals: readonly number[]): number[] {
  return intervals.map((interval) => transposeFrequency(frequency, interval));
}

/**
 * Returns the pitch name `interval` semitones away from `note`.
 */
export function transposeNote(
  note: string,
  interval: number,
  options: NoteToMidiOptions & MidiToNoteOptions = {},
): string {
  return midiToNote(noteToMidi(note, options) + requireFinite(interval, "interval"), options);
}

/**
 * Returns the pitch names `intervals` (semitones) away from `note`.
 */
export function harmonizeNote(
  note: string,
  intervals: readonly number[],
  options: NoteToMidiOptions & MidiToNoteOptions = {},
): string[] {
  return intervals.map((interval) => transposeNote(note, interval, options));
}
