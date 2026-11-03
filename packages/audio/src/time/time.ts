import { isNumber, isObject, isString } from "@temelj/value";

import type { FrequencyToMidiOptions } from "./pitch.ts";

import { AudioRangeError } from "../errors.ts";
import { requireFinite, requireNonNegative, requirePositive } from "../validation.ts";
import { frequencyToMidi } from "./pitch.ts";

export type TimeSignatureExpression = number | readonly [numerator: number, denominator: number];

/**
 * Time helpers bound to a context clock: relative expressions such as `"+0.5"` resolve against
 * `immediate`.
 */
export type TimeScope = {
  /**
   * Scheduling time, including any look-ahead.
   */
  readonly now: number;
  readonly immediate: number;
  /**
   * `seconds` after the time the scope was created.
   */
  plus(seconds: number): number;
  toSeconds(time: TimeExpression, options?: TimeScopeOptions): number;
  toTicks(time: TimeExpression, options?: TimeScopeOptions): number;
  quantize(
    time: TimeExpression,
    subdivision: TimeExpression,
    options?: TimeScopeOptions & { readonly percent?: number },
  ): number;
};

export type TimeScopeOptions = Omit<TimeParseOptions, "now">;

export type TimeExpression = number | string | TimeExpressionMap;

export type TimeExpressionMap = Readonly<Record<string, number | undefined>>;

const DEFAULT_BPM = 120;

const DEFAULT_PPQ = 192;

const DEFAULT_SAMPLE_RATE = 44_100;

const DEFAULT_TIME_SIGNATURE = 4;

export type TimeParseOptions = FrequencyToMidiOptions & {
  readonly bpm?: number;
  readonly now?: number;
  readonly ppq?: number;
  readonly sampleRate?: number;
  readonly timeSignature?: TimeSignatureExpression;
};

function secondsPerBeat(bpm: number): number {
  return 60 / requirePositive(bpm, "bpm");
}

function dottedNoteScalar(dots: string): number {
  let scalar = 1;
  let addition = 0.5;

  for (const _dot of dots) {
    scalar += addition;
    addition /= 2;
  }

  return scalar;
}

function assertTimeSignature(value: TimeSignatureExpression): number {
  const normalized = isNumber(value) ? value : (value[0] / value[1]) * 4;

  return requirePositive(normalized, "timeSignature");
}

/**
 * Converts a time expression to seconds. Accepted forms:
 *
 * - A number, or a numeric string, is seconds. `"0.5s"` and `"500ms"` also work.
 * - Note values (`4n`, dotted `8n.`, triplet `8t`) and bars (`1m`) follow `options.bpm`.
 * - `bars:beats:sixteenths` positions (`1:2:0`) count bars of `options.timeSignature` beats.
 * - Ticks (`192i`) count `options.ppq` per quarter note.
 * - `2hz` is the period of a 2 Hz cycle, and `100samples` is measured at `options.sampleRate`.
 * - A leading `+` or `-` (`+0.5`, `+4n`) is relative to `options.now`.
 * - An object sums its entries times their counts, so `{ "4n": 2 }` is two quarter notes.
 *
 * @throws {AudioRangeError} When the expression cannot be parsed.
 */
export function toSeconds(time: TimeExpression, options: TimeParseOptions = {}): number {
  if (isNumber(time)) {
    return time;
  }

  if (isObject(time)) {
    let total = 0;

    for (const [expression, quantity] of Object.entries(time)) {
      if (quantity === undefined) {
        continue;
      }

      requireFinite(quantity, "time expression quantity");

      total += toSeconds(expression, options) * quantity;
    }

    return total;
  }

  const bpm = options.bpm ?? DEFAULT_BPM;
  const now = options.now ?? 0;
  const ppq = requirePositive(options.ppq ?? DEFAULT_PPQ, "ppq");
  const sampleRate = requirePositive(options.sampleRate ?? DEFAULT_SAMPLE_RATE, "sampleRate");
  const timeSignature = assertTimeSignature(options.timeSignature ?? DEFAULT_TIME_SIGNATURE);
  const value = time.trim();

  if (value.length === 0) {
    return 0;
  }

  const relative = value[0] === "+" || value[0] === "-";

  if (relative) {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return now + parsed;
    }

    const sign = value[0] === "-" ? -1 : 1;

    return now + sign * toSeconds(value.slice(1), { ...options, now: 0 });
  }

  const measureMatch = /^(\d+(?:\.\d+)?)m$/.exec(value);

  if (measureMatch) {
    return Number.parseFloat(measureMatch[1]!) * timeSignature * secondsPerBeat(bpm);
  }

  const musicalMatch = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)(?::(\d+(?:\.\d+)?))?$/.exec(value);

  if (musicalMatch) {
    const bars = Number.parseFloat(musicalMatch[1]!);
    const beats = Number.parseFloat(musicalMatch[2]!);

    const sixteenths = musicalMatch[3] === undefined ? 0 : Number.parseFloat(musicalMatch[3]);

    return (bars * timeSignature + beats + sixteenths / 4) * secondsPerBeat(bpm);
  }

  const tickMatch = /^(\d+(?:\.\d+)?)i$/.exec(value);

  if (tickMatch) {
    return ticksToSeconds(Number.parseFloat(tickMatch[1]!), { bpm, ppq });
  }

  const secondsMatch = /^(\d+(?:\.\d+)?)s$/i.exec(value);

  if (secondsMatch) {
    return Number.parseFloat(secondsMatch[1]!);
  }

  const millisecondsMatch = /^(\d+(?:\.\d+)?)ms$/i.exec(value);

  if (millisecondsMatch) {
    return Number.parseFloat(millisecondsMatch[1]!) / 1000;
  }

  const frequencyMatch = /^(\d+(?:\.\d+)?)hz$/i.exec(value);

  if (frequencyMatch) {
    return 1 / Number.parseFloat(frequencyMatch[1]!);
  }

  const samplesMatch = /^(\d+(?:\.\d+)?)samples$/i.exec(value);

  if (samplesMatch) {
    return Number.parseFloat(samplesMatch[1]!) / sampleRate;
  }

  const tripletMatch = /^(\d+(?:\.\d+)?)t$/.exec(value);

  if (tripletMatch) {
    return secondsPerBeat(bpm) * (4 / Number.parseFloat(tripletMatch[1]!)) * (2 / 3);
  }

  const noteMatch = /^(\d+(?:\.\d+)?)n(\.*)$/.exec(value);

  if (noteMatch) {
    return (
      secondsPerBeat(bpm) * (4 / Number.parseFloat(noteMatch[1]!)) * dottedNoteScalar(noteMatch[2]!)
    );
  }

  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) {
    return Number(value);
  }

  return AudioRangeError.invalidOption("time expression", time);
}

/**
 * Converts a time expression to transport ticks at `options.ppq` per quarter note. See
 * `toSeconds()` for the accepted forms.
 */
export function toTicks(time: TimeExpression, options: TimeParseOptions = {}): number {
  if (isString(time)) {
    const value = time.trim();
    const relative = value[0] === "+" || value[0] === "-";

    if (relative) {
      const nowTicks = isNumber(options.now) ? toTicks(options.now, options) : 0;
      const sign = value[0] === "-" ? -1 : 1;

      return nowTicks + sign * toTicks(value.slice(1), { ...options, now: 0 });
    }

    const tickMatch = /^(\d+(?:\.\d+)?)i$/.exec(value);

    if (tickMatch) {
      return Number.parseFloat(tickMatch[1]!);
    }
  }

  const bpm = options.bpm ?? DEFAULT_BPM;
  const ppq = requirePositive(options.ppq ?? DEFAULT_PPQ, "ppq");

  return (toSeconds(time, options) / secondsPerBeat(bpm)) * ppq;
}

/**
 * Converts a time expression to milliseconds. See `toSeconds()`.
 */
export function toMilliseconds(time: TimeExpression, options: TimeParseOptions = {}): number {
  return toSeconds(time, options) * 1000;
}

/**
 * Converts seconds to milliseconds.
 */
export function secondsToMilliseconds(seconds: number): number {
  requireFinite(seconds, "seconds");

  return seconds * 1000;
}

/**
 * Converts milliseconds to seconds.
 */
export function millisecondsToSeconds(milliseconds: number): number {
  requireFinite(milliseconds, "milliseconds");

  return milliseconds / 1000;
}

/**
 * Converts a time expression to a (fractional) number of samples at `options.sampleRate` (44,100 by
 * default).
 */
export function toSamples(time: TimeExpression, options: TimeParseOptions = {}): number {
  const sampleRate = requirePositive(options.sampleRate ?? DEFAULT_SAMPLE_RATE, "sampleRate");

  return toSeconds(time, options) * sampleRate;
}

/**
 * Converts seconds to a (fractional) number of samples at `options.sampleRate` (44,100 by default).
 */
export function secondsToSamples(seconds: number, options: TimeParseOptions = {}): number {
  requireFinite(seconds, "seconds");

  const sampleRate = requirePositive(options.sampleRate ?? DEFAULT_SAMPLE_RATE, "sampleRate");

  return seconds * sampleRate;
}

/**
 * Converts a number of samples at `options.sampleRate` (44,100 by default) to seconds.
 */
export function samplesToSeconds(samples: number, options: TimeParseOptions = {}): number {
  requireFinite(samples, "samples");

  const sampleRate = requirePositive(options.sampleRate ?? DEFAULT_SAMPLE_RATE, "sampleRate");

  return samples / sampleRate;
}

/**
 * Returns the frequency in hertz of a period given as a time expression (`4n` at 120 BPM is 2 Hz).
 */
export function toFrequency(time: TimeExpression, options: TimeParseOptions = {}): number {
  return 1 / toSeconds(time, options);
}

/**
 * Returns the fractional MIDI note whose frequency matches the period of a time expression.
 */
export function toMidi(time: TimeExpression, options: TimeParseOptions = {}): number {
  return frequencyToMidi(toFrequency(time, options), options);
}

/**
 * Converts transport ticks to seconds at `options.bpm` and `options.ppq`.
 */
export function ticksToSeconds(ticks: number, options: TimeParseOptions = {}): number {
  requireFinite(ticks, "ticks");

  const bpm = options.bpm ?? DEFAULT_BPM;
  const ppq = requirePositive(options.ppq ?? DEFAULT_PPQ, "ppq");

  return (ticks / ppq) * secondsPerBeat(bpm);
}

/**
 * Formats transport ticks as `bars:beats:sixteenths`, counting from `0:0:0`.
 */
export function ticksToBarsBeatsSixteenths(
  ticks: number,
  options: Pick<TimeParseOptions, "ppq" | "timeSignature"> = {},
): string {
  requireFinite(ticks, "ticks");

  const ppq = requirePositive(options.ppq ?? DEFAULT_PPQ, "ppq");
  const timeSignature = assertTimeSignature(options.timeSignature ?? DEFAULT_TIME_SIGNATURE);
  const totalSixteenths = ticks / (ppq / 4);
  const sixteenthsPerBar = timeSignature * 4;
  const bars = Math.floor(totalSixteenths / sixteenthsPerBar);
  const remaining = totalSixteenths - bars * sixteenthsPerBar;
  const beats = Math.floor(remaining / 4);
  const sixteenths = remaining - beats * 4;

  return `${bars}:${beats}:${Number.isInteger(sixteenths) ? sixteenths : Number(sixteenths.toFixed(6))}`;
}

/**
 * Moves `time` towards the nearest `subdivision` boundary. `options.percent` is the fraction of the
 * distance to cover, from 0 (no change) to 1 (the default, snap to the boundary).
 */
export function quantizeTime(
  time: TimeExpression,
  subdivision: TimeExpression,
  { percent = 1, ...options }: TimeParseOptions & { readonly percent?: number } = {},
): number {
  requireFinite(percent, "percent");

  const value = toSeconds(time, options);
  const step = toSeconds(subdivision, options);

  requirePositive(step, "subdivision");

  const ideal = Math.round(value / step) * step;

  return value + (ideal - value) * percent;
}

/**
 * Returns the note value (such as `8n.` or `16t`) closest to `seconds` at `options.bpm`.
 */
export function secondsToNotation(
  seconds: number,
  options: Pick<TimeParseOptions, "bpm"> = {},
): string {
  requireNonNegative(seconds, "seconds");

  if (seconds === 0) {
    return "0";
  }

  const bpm = options.bpm ?? DEFAULT_BPM;
  const candidates: string[] = [];

  for (let subdivision = 1; subdivision <= 128; subdivision *= 2) {
    candidates.push(`${subdivision}n.`);
    candidates.push(`${subdivision}n`);
    candidates.push(`${subdivision}t`);
  }

  let closest = candidates[0]!;
  let closestDistance = Math.abs(toSeconds(closest, { bpm }) - seconds);

  for (const candidate of candidates.slice(1)) {
    const distance = Math.abs(toSeconds(candidate, { bpm }) - seconds);

    if (distance < closestDistance) {
      closest = candidate;
      closestDistance = distance;
    }
  }

  return closest;
}

/**
 * Creates the `time` helpers handed to play callbacks. `now` and `immediate` read the given clocks
 * on every access. `plus()` adds to the immediate time captured when the scope was created, while
 * the conversion methods resolve relative expressions against the current immediate time.
 */
export function createTimeScope(options: {
  readonly getImmediateTime: () => number;
  readonly getNowTime: () => number;
}): TimeScope {
  const capturedNow = options.getImmediateTime();

  const parse = (scopeOptions: TimeScopeOptions = {}): TimeParseOptions => ({
    ...scopeOptions,
    now: options.getImmediateTime(),
  });

  return {
    get now() {
      return options.getNowTime();
    },
    get immediate() {
      return options.getImmediateTime();
    },
    plus(seconds) {
      return capturedNow + seconds;
    },
    toSeconds(time, scopeOptions) {
      return toSeconds(time, parse(scopeOptions));
    },
    toTicks(time, scopeOptions) {
      return toTicks(time, parse(scopeOptions));
    },
    quantize(time, subdivision, scopeOptions = {}) {
      return quantizeTime(time, subdivision, { ...scopeOptions, ...parse(scopeOptions) });
    },
  };
}
