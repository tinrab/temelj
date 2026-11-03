import type { RunState } from "../unit.ts";
import type { TimeExpression } from "./time.ts";
import type { Transport, TransportEventId } from "./transport.ts";

import { AudioRangeError } from "../errors.ts";
import { requireInRange, requireNonNegative, requirePositive } from "../validation.ts";

export type AudioEventCallbackContext = {
  readonly barsBeatsSixteenths: string;
  readonly index?: number;
  readonly position: number;
  readonly ticks: number;
  readonly time: number;
};

export type AudioEventCallback<TValue> = (
  time: number,
  value: TValue,
  context: AudioEventCallbackContext,
) => void;

export type AudioEventOptions = {
  /**
   * Random timing offset: `true` for ±20 ms, or a maximum offset.
   */
  readonly humanize?: boolean | TimeExpression;
  readonly mute?: boolean;
  /**
   * Chance in [0, 1] that each event fires.
   */
  readonly probability?: number;
  readonly random?: () => number;
};

export type LoopOptions = AudioEventOptions & {
  readonly interval?: TimeExpression;
  readonly iterations?: number;
  readonly playbackRate?: number;
  readonly startPosition?: TimeExpression;
};

export type PartEvent<TValue> = {
  readonly time: TimeExpression;
  readonly value: TValue;
};

export type PartOptions = AudioEventOptions & {
  readonly loop?: boolean;
  readonly loopEnd?: TimeExpression;
  readonly loopStart?: TimeExpression;
  readonly playbackRate?: number;
};

export type SequenceOptions = AudioEventOptions & {
  readonly interval?: TimeExpression;
  readonly loop?: boolean;
  /**
   * Step index the loop ends before. 0 (the default) loops through the last step.
   */
  readonly loopEnd?: number;
  readonly loopStart?: number;
  readonly playbackRate?: number;
  readonly startPosition?: TimeExpression;
};

export type PatternName =
  | "alternateDown"
  | "alternateUp"
  | "down"
  | "downUp"
  | "random"
  | "randomOnce"
  | "randomWalk"
  | "up"
  | "upDown";

export type PatternOptions = AudioEventOptions & {
  readonly interval?: TimeExpression;
  readonly iterations?: number;
  readonly pattern?: PatternName;
  readonly playbackRate?: number;
  readonly startPosition?: TimeExpression;
};

const DEFAULT_HUMANIZE_SECONDS = 0.02;

/**
 * Base for event sources scheduled on a transport. It owns the scheduler ids, and for each callback
 * decides whether to skip it (`mute`, `probability`) and how far to shift it (`humanize`).
 */
abstract class TransportEvent {
  readonly transport: Transport;
  readonly #random: () => number;
  #ids: TransportEventId[] = [];
  #humanize: boolean | TimeExpression;
  #mute: boolean;
  #probability: number;
  #disposed = false;

  constructor(transport: Transport, options: AudioEventOptions) {
    this.transport = transport;
    this.#random = options.random ?? Math.random;
    this.#humanize = options.humanize ?? false;
    this.#mute = options.mute === true;
    this.#probability = requireInRange(options.probability ?? 1, 0, 1, "probability");
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get humanize(): boolean | TimeExpression {
    return this.#humanize;
  }

  get mute(): boolean {
    return this.#mute;
  }

  get probability(): number {
    return this.#probability;
  }

  get state(): RunState {
    return this.#ids.length > 0 ? "started" : "stopped";
  }

  setHumanize(humanize: boolean | TimeExpression): void {
    this.#humanize = humanize;
  }

  setMute(mute: boolean): void {
    this.#mute = mute;
  }

  setProbability(probability: number): void {
    this.#probability = requireInRange(probability, 0, 1, "probability");
  }

  stop(): this {
    for (const id of this.#ids) {
      this.transport.cancel(id);
    }

    this.#ids = [];

    return this;
  }

  dispose(): void {
    if (!this.#disposed) {
      this.#disposed = true;
      this.stop();
    }
  }

  protected get random(): () => number {
    return this.#random;
  }

  protected track(id: TransportEventId): void {
    this.#ids.push(id);
  }

  /**
   * Restarts scheduling after a setting that affects timing changed.
   */
  protected abstract restart(): void;

  protected restartIfStarted(): void {
    if (this.#ids.length > 0) {
      this.restart();
    }
  }

  /**
   * Calls `callback` at `time` shifted by the humanize offset, unless the event is muted or loses
   * the `probability` roll.
   */
  protected dispatch<TValue>(
    callback: AudioEventCallback<TValue>,
    time: number,
    position: number,
    index: number,
    value: TValue,
  ): void {
    if (this.#mute || this.#random() > this.#probability) {
      return;
    }

    const at = time + this.#humanizeOffset();
    callback(at, value, {
      barsBeatsSixteenths: this.transport.toBarsBeatsSixteenths(position),
      index,
      position,
      ticks: this.transport.toTicks(position),
      time: at,
    });
  }

  #humanizeOffset(): number {
    if (this.#humanize === false) {
      return 0;
    }

    const range =
      this.#humanize === true ? DEFAULT_HUMANIZE_SECONDS : this.transport.toSeconds(this.#humanize);

    return (this.#random() * 2 - 1) * range;
  }
}

/**
 * Repeats a callback every `interval`, optionally a fixed number of times.
 */
export class Loop extends TransportEvent {
  readonly iterations: number;
  readonly #callback: (time: number, context: AudioEventCallbackContext) => void;
  #interval: TimeExpression;
  #playbackRate: number;
  #startPosition: TimeExpression;

  constructor(
    transport: Transport,
    callback: (time: number, context: AudioEventCallbackContext) => void,
    options: LoopOptions = {},
  ) {
    super(transport, options);
    this.#callback = callback;
    this.#interval = options.interval ?? "4n";
    this.iterations = requireIterations(options.iterations ?? Number.POSITIVE_INFINITY);
    this.#playbackRate = requirePositive(options.playbackRate ?? 1, "playbackRate");
    this.#startPosition = options.startPosition ?? 0;
  }

  get interval(): TimeExpression {
    return this.#interval;
  }

  get playbackRate(): number {
    return this.#playbackRate;
  }

  get startPosition(): TimeExpression {
    return this.#startPosition;
  }

  start(position: TimeExpression = this.#startPosition): this {
    this.stop();
    this.#startPosition = position;
    let count = 0;
    this.track(
      this.transport.scheduleRepeat(
        (time, event) => {
          if (count >= this.iterations) {
            this.stop();

            return;
          }

          const index = count;
          count += 1;
          this.dispatch(
            (at, _value: undefined, context) => {
              this.#callback(at, context);
            },
            time,
            event.position,
            index,
            undefined,
          );

          if (count >= this.iterations) {
            this.stop();
          }
        },
        this.transport.toSeconds(this.#interval) / this.#playbackRate,
        position,
      ),
    );

    return this;
  }

  setInterval(interval: TimeExpression): void {
    this.#interval = interval;
    this.restartIfStarted();
  }

  setPlaybackRate(playbackRate: number): void {
    this.#playbackRate = requirePositive(playbackRate, "playbackRate");
    this.restartIfStarted();
  }

  protected restart(): void {
    this.start(this.#startPosition);
  }
}

/**
 * Timed values played relative to the start offset, optionally looping a region.
 */
export class Part<TValue> extends TransportEvent {
  readonly #callback: AudioEventCallback<TValue>;
  #events: PartEvent<TValue>[] = [];
  #loop: boolean;
  #loopStart: TimeExpression;
  #loopEnd: TimeExpression;
  #playbackRate: number;
  #offset: TimeExpression = 0;

  constructor(
    transport: Transport,
    callback: AudioEventCallback<TValue>,
    events: readonly PartEvent<TValue>[] = [],
    options: PartOptions = {},
  ) {
    super(transport, options);
    this.#callback = callback;
    this.#loop = options.loop === true;
    this.#loopStart = options.loopStart ?? 0;
    this.#loopEnd = options.loopEnd ?? "1m";
    this.#playbackRate = requirePositive(options.playbackRate ?? 1, "playbackRate");
    this.#events = [...events];
    this.#sort();
  }

  get events(): readonly PartEvent<TValue>[] {
    return [...this.#events];
  }

  get length(): number {
    return this.#events.length;
  }

  get loop(): boolean {
    return this.#loop;
  }

  get loopStart(): TimeExpression {
    return this.#loopStart;
  }

  get loopEnd(): TimeExpression {
    return this.#loopEnd;
  }

  get playbackRate(): number {
    return this.#playbackRate;
  }

  /**
   * Event at `time`, if any.
   */
  at(time: TimeExpression): PartEvent<TValue> | undefined {
    const seconds = this.transport.toSeconds(time);

    return this.#events.find((event) => this.transport.toSeconds(event.time) === seconds);
  }

  add(time: TimeExpression, value: TValue): this {
    this.#events.push({ time, value });
    this.#sort();
    this.restartIfStarted();

    return this;
  }

  /**
   * Replaces the value of the event at `time`, or adds one.
   */
  set(time: TimeExpression, value: TValue): this {
    const seconds = this.transport.toSeconds(time);

    const index = this.#events.findIndex(
      (event) => this.transport.toSeconds(event.time) === seconds,
    );

    if (index === -1) {
      return this.add(time, value);
    }

    this.#events[index] = { time: this.#events[index]?.time ?? time, value };
    this.restartIfStarted();

    return this;
  }

  /**
   * Removes events at `time`, or only those whose value is `value`.
   */
  remove(time: TimeExpression, value?: TValue): this {
    const seconds = this.transport.toSeconds(time);
    this.#events = this.#events.filter(
      (event) =>
        this.transport.toSeconds(event.time) !== seconds ||
        (value !== undefined && !Object.is(event.value, value)),
    );
    this.restartIfStarted();

    return this;
  }

  clear(): this {
    this.stop();
    this.#events = [];

    return this;
  }

  start(offset: TimeExpression = 0): this {
    this.stop();
    this.#offset = offset;
    const offsetSeconds = this.transport.toSeconds(offset);

    if (!this.#loop) {
      this.#events.forEach((event, index) => {
        this.track(
          this.transport.schedule(
            (time, transportEvent) => {
              this.dispatch(this.#callback, time, transportEvent.position, index, event.value);
            },
            offsetSeconds + this.transport.toSeconds(event.time) / this.#playbackRate,
          ),
        );
      });

      return this;
    }

    const loopStart = this.transport.toSeconds(this.#loopStart);
    const loopEnd = this.transport.toSeconds(this.#loopEnd);
    const period = (loopEnd - loopStart) / this.#playbackRate;

    if (!(period > 0)) {
      AudioRangeError.invalidRange("loop", loopStart, loopEnd);
    }

    this.#events.forEach((event, index) => {
      const seconds = this.transport.toSeconds(event.time);

      if (seconds < loopStart || seconds >= loopEnd) {
        return;
      }

      this.track(
        this.transport.scheduleRepeat(
          (time, transportEvent) => {
            this.dispatch(this.#callback, time, transportEvent.position, index, event.value);
          },
          period,
          offsetSeconds + (seconds - loopStart) / this.#playbackRate,
        ),
      );
    });

    return this;
  }

  setLoop(loop: boolean): void {
    this.#loop = loop;
    this.restartIfStarted();
  }

  setLoopPoints(loopStart: TimeExpression, loopEnd: TimeExpression): void {
    this.#loopStart = loopStart;
    this.#loopEnd = loopEnd;
    this.restartIfStarted();
  }

  setPlaybackRate(playbackRate: number): void {
    this.#playbackRate = requirePositive(playbackRate, "playbackRate");
    this.restartIfStarted();
  }

  /**
   * Replaces every event.
   */
  protected replaceEvents(events: readonly PartEvent<TValue>[]): void {
    this.#events = [...events];
    this.#sort();
    this.restartIfStarted();
  }

  protected restart(): void {
    this.start(this.#offset);
  }

  #sort(): void {
    this.#events.sort(
      (left, right) => this.transport.toSeconds(left.time) - this.transport.toSeconds(right.time),
    );
  }
}

/**
 * Values played one per `interval` step, optionally looping a range of steps.
 */
export class Sequence<TValue> extends Part<TValue> {
  readonly startPosition: TimeExpression;
  #values: readonly TValue[];
  #interval: TimeExpression;
  #loopStartStep: number;
  #loopEndStep: number;

  constructor(
    transport: Transport,
    callback: AudioEventCallback<TValue>,
    values: readonly TValue[],
    options: SequenceOptions = {},
  ) {
    super(transport, callback, [], { ...options, loopEnd: undefined, loopStart: undefined });
    this.startPosition = options.startPosition ?? 0;
    this.#values = values;
    this.#interval = options.interval ?? "8n";
    this.#loopStartStep = requireStep(options.loopStart ?? 0, "loopStart");
    this.#loopEndStep = requireStep(options.loopEnd ?? 0, "loopEnd");
    this.#rebuild();
  }

  get interval(): TimeExpression {
    return this.#interval;
  }

  get values(): readonly TValue[] {
    return this.#values;
  }

  setInterval(interval: TimeExpression): void {
    this.#interval = interval;
    this.#rebuild();
  }

  /**
   * Replaces the steps. Events added with `add()` are dropped.
   */
  setValues(values: readonly TValue[]): void {
    this.#values = values;
    this.#rebuild();
  }

  /**
   * Loops steps `[start, end)`. An `end` of 0 loops through the last step.
   */
  setLoopSteps(start: number, end: number): void {
    this.#loopStartStep = requireStep(start, "loopStart");
    this.#loopEndStep = requireStep(end, "loopEnd");
    this.#rebuild();
  }

  #stepTime(step: number): number {
    return (
      this.transport.toSeconds(this.startPosition) + step * this.transport.toSeconds(this.#interval)
    );
  }

  #rebuild(): void {
    const end = this.#loopEndStep === 0 ? this.#values.length : this.#loopEndStep;
    this.setLoopPoints(this.#stepTime(this.#loopStartStep), this.#stepTime(end));
    this.replaceEvents(this.#values.map((value, step) => ({ time: this.#stepTime(step), value })));
  }
}

/**
 * Walks through `values` in the order named by `pattern` (`up`, `down`, `alternateUp`, …), one
 * value per `interval`.
 */
export class Pattern<TValue> extends TransportEvent {
  readonly iterations: number;
  readonly #callback: AudioEventCallback<TValue>;
  #values: readonly TValue[];
  #pattern: PatternName;
  #interval: TimeExpression;
  #playbackRate: number;
  #startPosition: TimeExpression;
  #index: number | undefined;

  constructor(
    transport: Transport,
    callback: AudioEventCallback<TValue>,
    values: readonly TValue[],
    options: PatternOptions = {},
  ) {
    super(transport, options);
    requirePatternValues(values.length);
    this.#callback = callback;
    this.#values = values;
    this.#pattern = options.pattern ?? "up";
    this.#interval = options.interval ?? "8n";
    this.iterations = requireIterations(options.iterations ?? Number.POSITIVE_INFINITY);
    this.#playbackRate = requirePositive(options.playbackRate ?? 1, "playbackRate");
    this.#startPosition = options.startPosition ?? 0;
  }

  /**
   * Index into `values` of the latest step, counting steps that `mute` or `probability` skipped.
   */
  get index(): number | undefined {
    return this.#index;
  }

  get interval(): TimeExpression {
    return this.#interval;
  }

  get pattern(): PatternName {
    return this.#pattern;
  }

  get playbackRate(): number {
    return this.#playbackRate;
  }

  get startPosition(): TimeExpression {
    return this.#startPosition;
  }

  get value(): TValue | undefined {
    return this.#index === undefined ? undefined : this.#values[this.#index];
  }

  get values(): readonly TValue[] {
    return this.#values;
  }

  start(position: TimeExpression = this.#startPosition): this {
    this.stop();
    this.#startPosition = position;
    this.#index = undefined;
    const indexes = createPatternIndexGenerator(this.#values.length, this.#pattern, this.random);
    let count = 0;
    this.track(
      this.transport.scheduleRepeat(
        (time, event) => {
          const next = indexes.next();

          if (count >= this.iterations || next.done === true) {
            this.stop();

            return;
          }

          this.#index = next.value;
          const index = count;
          count += 1;
          // SAFETY: the generator yields indexes below `#values.length`.
          const value = this.#values[next.value] as TValue;
          this.dispatch(this.#callback, time, event.position, index, value);

          if (count >= this.iterations) {
            this.stop();
          }
        },
        this.transport.toSeconds(this.#interval) / this.#playbackRate,
        position,
      ),
    );

    return this;
  }

  setInterval(interval: TimeExpression): void {
    this.#interval = interval;
    this.restartIfStarted();
  }

  setPattern(pattern: PatternName): void {
    this.#pattern = pattern;
    this.restartIfStarted();
  }

  setPlaybackRate(playbackRate: number): void {
    this.#playbackRate = requirePositive(playbackRate, "playbackRate");
    this.restartIfStarted();
  }

  setValues(values: readonly TValue[]): void {
    requirePatternValues(values.length);
    this.#values = values;
    this.restartIfStarted();
  }

  protected restart(): void {
    this.start(this.#startPosition);
  }
}

export function* createPatternIndexGenerator(
  count: number,
  pattern: PatternName = "up",
  random: () => number = Math.random,
): IterableIterator<number> {
  requirePatternValues(count);
  const length = Math.floor(count);

  switch (pattern) {
    case "alternateDown": {
      yield* repeatPattern(length, alternateDownPattern);

      return;
    }

    case "alternateUp": {
      yield* repeatPattern(length, alternateUpPattern);

      return;
    }

    case "down": {
      yield* repeatPattern(length, downPattern);

      return;
    }

    case "downUp": {
      yield* alternatingPattern(length, false);

      return;
    }

    case "random": {
      yield* randomPattern(length, random);

      return;
    }

    case "randomOnce": {
      yield* repeatPattern(length, (patternLength) => randomOncePattern(patternLength, random));

      return;
    }

    case "randomWalk": {
      yield* randomWalkPattern(length, random);

      return;
    }

    case "up": {
      yield* repeatPattern(length, upPattern);

      return;
    }

    case "upDown": {
      yield* alternatingPattern(length, true);

      return;
    }
  }
}

function requireIterations(value: number): number {
  return value === Number.POSITIVE_INFINITY
    ? value
    : Math.floor(requireNonNegative(value, "iterations"));
}

function requireStep(value: number, name: string): number {
  return Math.floor(requireNonNegative(value, name));
}

function requirePatternValues(count: number): void {
  if (!(count >= 1)) {
    AudioRangeError.invalidOption("values", count);
  }
}

function* upPattern(count: number): IterableIterator<number> {
  for (let index = 0; index < count; index++) {
    yield index;
  }
}

function* downPattern(count: number): IterableIterator<number> {
  for (let index = count - 1; index >= 0; index--) {
    yield index;
  }
}

function* alternateUpPattern(count: number): IterableIterator<number> {
  let index = 0;
  let step = 0;

  while (index < count) {
    yield clampPatternIndex(index, count);
    step += 1;
    index += step % 2 === 1 ? 2 : -1;
  }
}

function* alternateDownPattern(count: number): IterableIterator<number> {
  let index = count - 1;
  let step = 0;

  while (index >= 0) {
    yield clampPatternIndex(index, count);
    step += 1;
    index += step % 2 === 1 ? -2 : 1;
  }
}

function* alternatingPattern(count: number, directionUp: boolean): IterableIterator<number> {
  if (count === 1) {
    while (true) {
      yield 0;
    }
  }

  let index = directionUp ? 0 : count - 1;
  let up = directionUp;

  while (true) {
    yield clampPatternIndex(index, count);

    if (up) {
      index += 1;

      if (index >= count - 1) {
        up = false;
      }
    } else {
      index -= 1;

      if (index <= 0) {
        up = true;
      }
    }
  }
}

function* randomPattern(count: number, random: () => number): IterableIterator<number> {
  while (true) {
    yield Math.floor(clampRandom(random()) * count);
  }
}

function* randomOncePattern(count: number, random: () => number): IterableIterator<number> {
  const indexes = Array.from({ length: count }, (_value, index) => index);

  while (indexes.length > 0) {
    const [index] = indexes.splice(Math.floor(clampRandom(random()) * indexes.length), 1);
    yield index!;
  }
}

function* randomWalkPattern(count: number, random: () => number): IterableIterator<number> {
  if (count === 1) {
    while (true) {
      yield 0;
    }
  }

  let index = Math.floor(clampRandom(random()) * count);

  while (true) {
    if (index === 0) {
      index += 1;
    } else if (index === count - 1) {
      index -= 1;
    } else {
      index += clampRandom(random()) < 0.5 ? -1 : 1;
    }

    yield index;
  }
}

function* repeatPattern(
  count: number,
  pattern: (count: number) => IterableIterator<number>,
): IterableIterator<number> {
  while (true) {
    yield* pattern(count);
  }
}

function clampPatternIndex(index: number, count: number): number {
  return Math.min(count - 1, Math.max(0, index));
}

function clampRandom(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(0.999_999_999, Math.max(0, value));
}
