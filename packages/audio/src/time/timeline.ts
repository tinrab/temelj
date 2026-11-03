import type { PlaybackState } from "../unit.ts";

import { AudioRangeError } from "../errors.ts";
import { requireFinite, requireNonNegative } from "../validation.ts";

export type TimelineEvent = {
  readonly time: number;
};

export type TimelineOptions = {
  readonly increasing?: boolean;
  readonly memory?: number;
};

export type StateTimelineEvent = TimelineEvent & {
  readonly state: PlaybackState;
};

export type IntervalTimelineEvent = {
  readonly duration: number;
  readonly time: number;
};

/**
 * Events kept sorted by `time`. Events at the same time keep their insertion order.
 * `options.memory` caps how many events are kept and drops the oldest. With `options.increasing`,
 * adding an event earlier than the last one throws.
 */
export class Timeline<TEvent extends TimelineEvent> {
  #events: TEvent[] = [];
  #increasing: boolean;
  #memory: number;

  constructor(options: TimelineOptions = {}) {
    this.#increasing = options.increasing ?? false;
    this.#memory = validateMemory(options.memory ?? Number.POSITIVE_INFINITY);
  }

  get events(): readonly TEvent[] {
    return this.#events;
  }

  get length(): number {
    return this.#events.length;
  }

  add(event: TEvent): this {
    requireFinite(event.time, "event.time");
    const last = this.#events.at(-1);

    if (this.#increasing && last !== undefined && event.time < last.time) {
      AudioRangeError.invalidRange("timeline event time", last.time, event.time);
    }

    if (this.#increasing || this.#events.length === 0) {
      this.#events.push(event);
    } else {
      this.#events.splice(this.#search(event.time) + 1, 0, event);
    }

    if (this.#events.length > this.#memory) {
      this.#events.splice(0, this.#events.length - this.#memory);
    }

    return this;
  }

  cancel(after: number): this {
    requireFinite(after, "after");
    this.#events = this.#events.filter((event) => event.time < after);

    return this;
  }

  cancelBefore(time: number): this {
    requireFinite(time, "time");
    this.#events = this.#events.filter((event) => event.time > time);

    return this;
  }

  clear(): this {
    this.#events = [];

    return this;
  }

  dispose(): this {
    return this.clear();
  }

  forEach(callback: (event: TEvent) => void): this {
    for (const event of this.#events.slice()) {
      callback(event);
    }

    return this;
  }

  forEachAfter(time: number, callback: (event: TEvent) => void): this {
    requireFinite(time, "time");

    for (const event of this.#events.filter((entry) => entry.time > time)) {
      callback(event);
    }

    return this;
  }

  forEachAtTime(time: number, callback: (event: TEvent) => void): this {
    requireFinite(time, "time");

    for (const event of this.#events.filter((entry) => entry.time === time)) {
      callback(event);
    }

    return this;
  }

  forEachBefore(time: number, callback: (event: TEvent) => void): this {
    requireFinite(time, "time");

    for (const event of this.#events.filter((entry) => entry.time <= time)) {
      callback(event);
    }

    return this;
  }

  forEachBetween(startTime: number, endTime: number, callback: (event: TEvent) => void): this {
    requireFinite(startTime, "startTime");
    requireFinite(endTime, "endTime");

    if (endTime < startTime) {
      AudioRangeError.invalidRange("time", startTime, endTime);
    }

    for (const event of this.#events.filter(
      (entry) => entry.time >= startTime && entry.time < endTime,
    )) {
      callback(event);
    }

    return this;
  }

  forEachFrom(time: number, callback: (event: TEvent) => void): this {
    requireFinite(time, "time");

    for (const event of this.#events.filter((entry) => entry.time >= time)) {
      callback(event);
    }

    return this;
  }

  get(time: number): TEvent | undefined {
    requireFinite(time, "time");
    const index = this.#search(time);

    return index === -1 ? undefined : this.#events[index];
  }

  getAfter(time: number): TEvent | undefined {
    requireFinite(time, "time");

    return this.#events.find((event) => event.time > time);
  }

  getBefore(time: number): TEvent | undefined {
    requireFinite(time, "time");
    const index = this.#events.findIndex((event) => event.time >= time);

    if (index === -1) {
      return this.#events.at(-1);
    }

    return index > 0 ? this.#events[index - 1] : undefined;
  }

  peek(): TEvent | undefined {
    return this.#events[0];
  }

  previousEvent(event: TEvent): TEvent | undefined {
    const index = this.#events.indexOf(event);

    return index > 0 ? this.#events[index - 1] : undefined;
  }

  remove(event: TEvent): this {
    this.#events = this.#events.filter((entry) => entry !== event);

    return this;
  }

  shift(): TEvent | undefined {
    return this.#events.shift();
  }

  #search(time: number): number {
    let low = 0;
    let high = this.#events.length - 1;
    let found = -1;

    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const event = this.#events[middle];

      if (!event) {
        break;
      }

      if (event.time <= time) {
        found = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    return found;
  }
}

/**
 * A value that changes at scheduled times; `get(time)` returns the latest value set at or before
 * `time`, or the initial value. Only the last 10 changes are kept unless `options.memory` says
 * otherwise, so older times read the initial value.
 */
export class TimelineValue<TValue> {
  readonly #initialValue: TValue;
  readonly #timeline: Timeline<TimelineEvent & { readonly value: TValue }>;

  constructor(initialValue: TValue, options: TimelineOptions = { memory: 10 }) {
    this.#initialValue = initialValue;
    this.#timeline = new Timeline<TimelineEvent & { readonly value: TValue }>(options);
  }

  get length(): number {
    return this.#timeline.length;
  }

  get(time: number): TValue {
    return this.#timeline.get(time)?.value ?? this.#initialValue;
  }

  set(value: TValue, time: number): this {
    this.#timeline.add({ time, value });

    return this;
  }
}

/**
 * Records `PlaybackState` changes over time and answers which state was active at a given time.
 */
export class StateTimeline<TEvent extends StateTimelineEvent = StateTimelineEvent> {
  readonly #initialState: PlaybackState;
  readonly #timeline = new Timeline<TEvent>();

  constructor(initialState: PlaybackState = "stopped") {
    this.#initialState = initialState;
    this.setStateAtTime(initialState, 0);
  }

  get events(): readonly TEvent[] {
    return this.#timeline.events;
  }

  get length(): number {
    return this.#timeline.length;
  }

  getLastState(state: PlaybackState, time: number): TEvent | undefined {
    let match: TEvent | undefined;
    this.#timeline.forEachBefore(time, (event) => {
      if (event.state === state) {
        match = event;
      }
    });

    return match;
  }

  getNextState(state: PlaybackState, time: number): TEvent | undefined {
    return this.#timeline.events.find((event) => event.time >= time && event.state === state);
  }

  getValueAtTime(time: number): PlaybackState {
    return this.#timeline.get(time)?.state ?? this.#initialState;
  }

  setStateAtTime(
    state: PlaybackState,
    time: number,
    options?: Omit<TEvent, "state" | "time">,
  ): this {
    requireNonNegative(time, "time");

    // SAFETY: `TEvent` is a state event, built here from its required fields.
    this.#timeline.add({ ...options, state, time } as TEvent);

    return this;
  }
}

/**
 * Events that span a `time` and `duration`, with lookups for the events active at a given time.
 */
export class IntervalTimeline<TEvent extends IntervalTimelineEvent> {
  #events: TEvent[] = [];

  get events(): readonly TEvent[] {
    return this.#events;
  }

  get length(): number {
    return this.#events.length;
  }

  add(event: TEvent): this {
    requireFinite(event.time, "event.time");
    requireNonNegative(event.duration, "event.duration");
    this.#events.splice(this.#searchInsertIndex(event.time), 0, event);

    return this;
  }

  cancel(after: number): this {
    requireFinite(after, "after");
    this.#events = this.#events.filter((event) => event.time < after);

    return this;
  }

  clear(): this {
    this.#events = [];

    return this;
  }

  dispose(): this {
    return this.clear();
  }

  forEach(callback: (event: TEvent) => void): this {
    for (const event of this.#events.slice()) {
      callback(event);
    }

    return this;
  }

  forEachAtTime(time: number, callback: (event: TEvent) => void): this {
    requireFinite(time, "time");

    for (const event of this.#events.filter((entry) => isIntervalActive(entry, time))) {
      callback(event);
    }

    return this;
  }

  forEachFrom(time: number, callback: (event: TEvent) => void): this {
    requireFinite(time, "time");

    for (const event of this.#events.filter((entry) => entry.time >= time)) {
      callback(event);
    }

    return this;
  }

  get(time: number): TEvent | undefined {
    requireFinite(time, "time");
    let match: TEvent | undefined;

    for (const event of this.#events) {
      if (isIntervalActive(event, time)) {
        match = event;
      }
    }

    return match;
  }

  remove(event: TEvent): this {
    this.#events = this.#events.filter((entry) => entry !== event);

    return this;
  }

  #searchInsertIndex(time: number): number {
    const index = this.#events.findIndex((event) => event.time > time);

    return index === -1 ? this.#events.length : index;
  }
}

function isIntervalActive(event: IntervalTimelineEvent, time: number): boolean {
  return event.time <= time && time < event.time + event.duration;
}

function validateMemory(value: number): number {
  if (value !== Number.POSITIVE_INFINITY && (!Number.isInteger(value) || value < 0)) {
    AudioRangeError.invalidOption("memory", value);
  }

  return value;
}
