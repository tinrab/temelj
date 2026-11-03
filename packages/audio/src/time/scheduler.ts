import { isNumber } from "@temelj/value";

import type { AudioContextLike } from "../context/context.ts";
import type { PlaybackState, RunState } from "../unit.ts";
import type { TimeExpression, TimeSignatureExpression } from "./time.ts";

import { getAudioContextImmediateTime, getAudioContextNow } from "../context/context.ts";
import { AudioDisposedError } from "../errors.ts";
import { floorNonNegative, requireNonNegative, requirePositive } from "../validation.ts";
import { toSeconds as parseTimeExpression } from "./time.ts";

export type SchedulerEventId = number;

export type SchedulerEvent = {
  readonly id: SchedulerEventId;
  readonly interval?: number;
  readonly time: number;
};

export type SchedulerCallback = (time: number, event: SchedulerEvent) => void;

export type ClockCallback = (time: number, ticks: number) => void;

/**
 * Handle returned by a `setTimeout` implementation: a number in browsers, an object in Node.
 */
export type SchedulerTimer = number | ReturnType<typeof globalThis.setTimeout>;

export type SchedulerOptions = {
  readonly autoStart?: boolean;
  readonly bpm?: number;
  readonly context: AudioContextLike;
  readonly intervalSeconds?: number;
  readonly lookAhead?: number;
  readonly ppq?: number;
  readonly setTimeout?: (callback: () => void, delay: number) => SchedulerTimer;
  readonly clearTimeout?: (timer: SchedulerTimer) => void;
  readonly timeSignature?: TimeSignatureExpression;
};

export type ClockOptions = SchedulerOptions & {
  readonly callback?: ClockCallback;
  readonly frequency?: number;
  readonly ticks?: number;
};

type ScheduledEvent = SchedulerEvent & {
  callback: SchedulerCallback;
  canceled: boolean;
};

const DEFAULT_BPM = 120;

const DEFAULT_INTERVAL_SECONDS = 0.025;

const DEFAULT_LOOK_AHEAD = 0.1;

const DEFAULT_PPQ = 192;

const DEFAULT_TIME_SIGNATURE = 4;

function assertTimeSignature(value: TimeSignatureExpression): TimeSignatureExpression {
  const normalized = isNumber(value) ? value : (value[0] / value[1]) * 4;

  requirePositive(normalized, "timeSignature");

  return value;
}

/**
 * Look-ahead event scheduler: a timer wakes every `intervalSeconds` and runs callbacks due within
 * `lookAhead` seconds, passing each its exact audio time so it can schedule sample-accurate work.
 * It also holds the tempo and meter that musical time expressions resolve against.
 */
export class Scheduler {
  #bpm: number;
  #clearTimeout: (timer: SchedulerTimer) => void;
  #context: AudioContextLike;
  #events: ScheduledEvent[] = [];
  #intervalSeconds: number;
  #isDisposed = false;
  #isRunning = false;
  #lookAhead: number;
  #nextId = 1;
  #ppq: number;
  #setTimeout: (callback: () => void, delay: number) => SchedulerTimer;
  #timer: SchedulerTimer | undefined;
  #timeSignature: TimeSignatureExpression;

  constructor(options: SchedulerOptions) {
    this.#context = options.context;
    this.#bpm = requirePositive(options.bpm ?? DEFAULT_BPM, "bpm");
    this.#ppq = requirePositive(options.ppq ?? DEFAULT_PPQ, "ppq");
    this.#timeSignature = assertTimeSignature(options.timeSignature ?? DEFAULT_TIME_SIGNATURE);
    this.#intervalSeconds = requirePositive(
      options.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS,
      "intervalSeconds",
    );
    this.#lookAhead = Math.max(0, options.lookAhead ?? DEFAULT_LOOK_AHEAD);
    this.#setTimeout =
      options.setTimeout ?? ((callback, delay) => globalThis.setTimeout(callback, delay));
    this.#clearTimeout =
      options.clearTimeout ??
      ((timer) => {
        globalThis.clearTimeout(timer);
      });

    if (options.autoStart === true) {
      this.start();
    }
  }

  get bpm(): number {
    return this.#bpm;
  }

  set bpm(value: number) {
    this.#bpm = requirePositive(value, "bpm");
  }

  get ppq(): number {
    return this.#ppq;
  }

  set ppq(value: number) {
    this.#ppq = requirePositive(value, "ppq");
  }

  get timeSignature(): TimeSignatureExpression {
    return this.#timeSignature;
  }

  set timeSignature(value: TimeSignatureExpression) {
    this.#timeSignature = assertTimeSignature(value);
  }

  get context(): AudioContextLike {
    return this.#context;
  }

  get disposed(): boolean {
    return this.#isDisposed;
  }

  get eventCount(): number {
    return this.#events.length;
  }

  get isRunning(): boolean {
    return this.#isRunning;
  }

  get state(): RunState {
    return this.#isRunning ? "started" : "stopped";
  }

  get lookAhead(): number {
    return this.#lookAhead;
  }

  set lookAhead(value: number) {
    requireNonNegative(value, "lookAhead");

    this.#lookAhead = value;
  }

  get now(): number {
    return getAudioContextNow(this.#context);
  }

  get immediate(): number {
    return getAudioContextImmediateTime(this.#context);
  }

  cancel(id: SchedulerEventId): boolean {
    const event = this.#events.find((entry) => entry.id === id);

    if (!event) {
      return false;
    }

    event.canceled = true;
    this.#events = this.#events.filter((entry) => entry.id !== id);

    return true;
  }

  cancelAll(): void {
    for (const event of this.#events) {
      event.canceled = true;
    }

    this.#events = [];
  }

  dispose(): void {
    if (this.#isDisposed) {
      return;
    }

    this.stop();
    this.cancelAll();
    this.#isDisposed = true;
  }

  flush(until: TimeExpression = this.now + this.#lookAhead): void {
    this.#assertUsable();
    const horizon = this.toSeconds(until);

    while (true) {
      const event = this.#events.find((entry) => entry.time <= horizon);

      if (!event) {
        return;
      }

      this.#events = this.#events.filter((entry) => entry !== event);

      if (event.canceled) {
        continue;
      }

      event.callback(event.time, event);

      if (!event.canceled && isNumber(event.interval)) {
        const interval = requirePositive(event.interval, "interval");
        this.#events.push({
          ...event,
          time: event.time + interval,
        });
        this.#sortEvents();
      }
    }
  }

  schedule(callback: SchedulerCallback, time: TimeExpression): SchedulerEventId {
    return this.#addEvent(callback, time);
  }

  scheduleRepeat(
    callback: SchedulerCallback,
    interval: TimeExpression,
    startTime: TimeExpression = this.now,
  ): SchedulerEventId {
    const resolvedInterval = requirePositive(this.toSeconds(interval), "interval");

    return this.#addEvent(callback, startTime, resolvedInterval);
  }

  start(): this {
    this.#assertUsable();

    if (this.#isRunning) {
      return this;
    }

    this.#isRunning = true;
    this.#scheduleTimer();

    return this;
  }

  stop(): this {
    if (!this.#isRunning) {
      return this;
    }

    this.#isRunning = false;

    if (this.#timer !== undefined) {
      this.#clearTimeout(this.#timer);
      this.#timer = undefined;
    }

    return this;
  }

  toSeconds(time: TimeExpression): number {
    return parseTimeExpression(time, {
      bpm: this.#bpm,
      now: this.immediate,
      ppq: this.#ppq,
      timeSignature: this.#timeSignature,
    });
  }

  #addEvent(
    callback: SchedulerCallback,
    time: TimeExpression,
    interval?: number,
  ): SchedulerEventId {
    this.#assertUsable();
    const id = this.#nextId;
    this.#nextId += 1;

    this.#events.push({
      callback,
      canceled: false,
      id,
      interval,
      time: this.toSeconds(time),
    });
    this.#sortEvents();

    return id;
  }

  #assertUsable(): void {
    if (this.#isDisposed) {
      AudioDisposedError.disposed("audio scheduler");
    }
  }

  #scheduleTimer(): void {
    if (!this.#isRunning) {
      return;
    }

    if (this.#timer !== undefined) {
      this.#clearTimeout(this.#timer);
    }

    this.#timer = this.#setTimeout(() => {
      // A throwing callback must not stop the loop; the error still reaches the host.
      try {
        this.flush();
      } finally {
        this.#scheduleTimer();
      }
    }, this.#intervalSeconds * 1000);
  }

  #sortEvents(): void {
    this.#events.sort((left, right) => left.time - right.time || left.id - right.id);
  }
}

/**
 * Tick counter on a `Scheduler` that calls `callback` once per tick, `frequency` ticks per second.
 * `setTicksAtTime()` changes the count at a scheduled time.
 */
export class Clock {
  #callback: ClockCallback;
  #frequency: number;
  #scheduler: Scheduler;
  #schedulerId: SchedulerEventId | undefined;
  #state: PlaybackState = "stopped";
  #ticks: number;

  constructor(options: ClockOptions) {
    this.#callback = options.callback ?? (() => undefined);
    this.#frequency = requirePositive(options.frequency ?? 1, "frequency");
    this.#scheduler = new Scheduler(options);
    this.#ticks = floorNonNegative(options.ticks ?? 0, "ticks");
  }

  get callback(): ClockCallback {
    return this.#callback;
  }

  set callback(callback: ClockCallback) {
    this.#callback = callback;
  }

  get frequency(): number {
    return this.#frequency;
  }

  set frequency(frequency: number) {
    this.#frequency = requirePositive(frequency, "frequency");

    if (this.#state === "started") {
      this.#reschedule();
    }
  }

  get scheduler(): Scheduler {
    return this.#scheduler;
  }

  get disposed(): boolean {
    return this.#scheduler.disposed;
  }

  get state(): PlaybackState {
    return this.#state;
  }

  get ticks(): number {
    return this.#ticks;
  }

  set ticks(ticks: number) {
    this.#ticks = floorNonNegative(ticks, "ticks");
  }

  get seconds(): number {
    return this.#ticks / this.#frequency;
  }

  set seconds(seconds: number) {
    requireNonNegative(seconds, "seconds");

    this.#ticks = Math.floor(seconds * this.#frequency);
  }

  dispose(): void {
    this.stop();
    this.#scheduler.dispose();
  }

  flush(until?: TimeExpression): void {
    this.#scheduler.flush(until);
  }

  getSecondsAtTime(time: TimeExpression): number {
    const resolvedTime = this.#scheduler.toSeconds(time);

    if (this.#state !== "started") {
      return this.seconds;
    }

    return this.seconds + Math.max(0, resolvedTime - this.#scheduler.immediate);
  }

  getTicksAtTime(time: TimeExpression = this.#scheduler.immediate): number {
    return Math.floor(this.getSecondsAtTime(time) * this.#frequency);
  }

  getTimeOfTick(tick: number, before: TimeExpression = this.#scheduler.immediate): number {
    const resolvedTick = floorNonNegative(tick, "tick");
    const resolvedBefore = this.#scheduler.toSeconds(before);
    const deltaTicks = resolvedTick - this.#ticks;

    return resolvedBefore + deltaTicks / this.#frequency;
  }

  nextTickTime(offset: number, when: TimeExpression = this.#scheduler.immediate): number {
    const resolvedOffset = floorNonNegative(offset, "offset");
    const currentTick = this.getTicksAtTime(when);

    return this.getTimeOfTick(currentTick + resolvedOffset, when);
  }

  pause(): this {
    if (this.#state !== "started") {
      return this;
    }

    this.#clearScheduledTick();
    this.#state = "paused";

    return this;
  }

  setTicksAtTime(ticks: number, time: TimeExpression): this {
    const resolvedTicks = floorNonNegative(ticks, "ticks");
    const resolvedTime = this.#scheduler.toSeconds(time);
    this.#scheduler.schedule(() => {
      this.#ticks = resolvedTicks;
    }, resolvedTime);

    return this;
  }

  start(time: TimeExpression = this.#scheduler.immediate, offset?: number): this {
    if (isNumber(offset)) {
      this.#ticks = floorNonNegative(offset, "offset");
    }

    this.#state = "started";
    this.#clearScheduledTick();
    this.#schedulerId = this.#scheduler.scheduleRepeat(
      (eventTime) => {
        if (this.#state !== "started") {
          return;
        }

        const tick = this.#ticks;
        this.#ticks += 1;
        this.#callback(eventTime, tick);
      },
      1 / this.#frequency,
      time,
    );
    this.#scheduler.start();

    return this;
  }

  stop(): this {
    this.#clearScheduledTick();
    this.#ticks = 0;
    this.#state = "stopped";

    return this;
  }

  #clearScheduledTick(): void {
    if (isNumber(this.#schedulerId)) {
      this.#scheduler.cancel(this.#schedulerId);
      this.#schedulerId = undefined;
    }
  }

  #reschedule(): void {
    const ticks = this.#ticks;
    this.start(this.#scheduler.immediate, ticks);
  }
}
