import type { PlaybackState } from "../unit.ts";

import { requireFinite, requirePositive } from "../validation.ts";

export type TickParamUnit = "bpm" | "hertz";

export type TickParamOptions = {
  readonly multiplier?: number;
  readonly unit?: TickParamUnit;
  readonly value?: number;
};

export type TickSourceOptions = TickParamOptions & {
  readonly offset?: number;
};

type TickEvent = {
  kind: "linear" | "set";
  rate: number;
  ticks: number;
  time: number;
  value: number;
};

type TickSourceStateEvent = {
  state: PlaybackState;
  time: number;
};

type TickSourceOffsetEvent = {
  ticks: number;
  time: number;
};

/**
 * Tempo or frequency curve that converts between seconds and ticks by integrating the rate.
 */
export class TickParam {
  #events: TickEvent[] = [];
  #multiplier: number;
  #unit: TickParamUnit;

  constructor(options: TickParamOptions = {}) {
    this.#unit = options.unit ?? "hertz";
    this.#multiplier = requirePositive(options.multiplier ?? 1, "multiplier");
    this.setValueAtTime(requireFinite(options.value ?? 1, "value"), 0);
  }

  get multiplier(): number {
    return this.#multiplier;
  }

  get unit(): TickParamUnit {
    return this.#unit;
  }

  get value(): number {
    return this.getValueAtTime(0);
  }

  #rateFromValue(value: number): number {
    if (this.#unit === "bpm") {
      return (value / 60) * this.#multiplier;
    }

    return value * this.#multiplier;
  }

  #insertEvent(event: Omit<TickEvent, "ticks">): void {
    this.#events = this.#events.filter((item) => item.time !== event.time);
    this.#events.push({ ...event, ticks: 0 });
    this.#events.sort((left, right) => left.time - right.time);
    this.#recalculateTicks();
  }

  #recalculateTicks(): void {
    if (this.#events.length === 0) {
      return;
    }

    this.#events[0]!.ticks = 0;

    for (let i = 1; i < this.#events.length; i++) {
      const previous = this.#events[i - 1]!;
      const event = this.#events[i]!;
      event.ticks = previous.ticks + integrateTickSegment(previous, event, event.time);
    }
  }

  #eventBeforeOrAt(time: number): TickEvent {
    let event = this.#events[0]!;

    for (const candidate of this.#events) {
      if (candidate.time > time) {
        break;
      }

      event = candidate;
    }

    return event;
  }

  #eventAfter(time: number): TickEvent | undefined {
    return this.#events.find((event) => event.time > time);
  }

  cancelScheduledValues(time: number): this {
    const value = this.getValueAtTime(time);
    const ticks = this.getTicksAtTime(time);
    this.#events = this.#events.filter((event) => event.time < time);
    this.#events.push({
      kind: "set",
      rate: this.#rateFromValue(value),
      ticks,
      time,
      value,
    });
    this.#events.sort((left, right) => left.time - right.time);

    return this;
  }

  getDurationOfTicks(ticks: number, time = 0): number {
    const startTick = this.getTicksAtTime(time);

    return this.getTimeOfTick(startTick + requireFinite(ticks, "ticks")) - time;
  }

  getTicksAtTime(time: number): number {
    const resolvedTime = requireFinite(time, "time");
    const event = this.#eventBeforeOrAt(resolvedTime);
    const after = this.#eventAfter(event.time);

    return Math.max(0, event.ticks + integrateTickSegment(event, after, resolvedTime));
  }

  getTimeOfTick(tick: number): number {
    const resolvedTick = requireFinite(tick, "tick");

    if (resolvedTick <= 0) {
      return 0;
    }

    for (let i = 0; i < this.#events.length; i++) {
      const event = this.#events[i]!;
      const after = this.#events[i + 1];
      const nextTicks = after === undefined ? Number.POSITIVE_INFINITY : after.ticks;

      if (resolvedTick <= nextTicks) {
        return invertTickSegment(event, after, resolvedTick);
      }
    }

    return Number.POSITIVE_INFINITY;
  }

  getValueAtTime(time: number): number {
    const resolvedTime = requireFinite(time, "time");
    const event = this.#eventBeforeOrAt(resolvedTime);
    const after = this.#eventAfter(event.time);

    if (after?.kind === "linear" && resolvedTime < after.time) {
      const progress = (resolvedTime - event.time) / (after.time - event.time);

      return event.value + (after.value - event.value) * Math.min(1, Math.max(0, progress));
    }

    return event.value;
  }

  linearRampToValueAtTime(value: number, time: number): this {
    const resolvedValue = requireFinite(value, "value");
    const resolvedTime = requireFinite(time, "time");
    this.#insertEvent({
      kind: "linear",
      rate: this.#rateFromValue(resolvedValue),
      time: resolvedTime,
      value: resolvedValue,
    });

    return this;
  }

  setMultiplier(value: number): this {
    const currentValue = this.value;
    this.#multiplier = requirePositive(value, "multiplier");
    this.#events = [];
    this.setValueAtTime(currentValue, 0);

    return this;
  }

  setValueAtTime(value: number, time: number): this {
    const resolvedValue = requireFinite(value, "value");
    const resolvedTime = requireFinite(time, "time");
    this.#insertEvent({
      kind: "set",
      rate: this.#rateFromValue(resolvedValue),
      time: resolvedTime,
      value: resolvedValue,
    });

    return this;
  }

  ticksToTime(ticks: number, when = 0): number {
    return this.getDurationOfTicks(ticks, when);
  }

  timeToTicks(duration: number, when = 0): number {
    const resolvedWhen = requireFinite(when, "when");
    const resolvedDuration = requireFinite(duration, "duration");

    return this.getTicksAtTime(resolvedWhen + resolvedDuration) - this.getTicksAtTime(resolvedWhen);
  }
}

/**
 * Tick counter driven by a `TickParam`. State changes are scheduled at context times, so
 * `getTicksAtTime()` answers for past and future times alike.
 */
export class TickSource {
  readonly frequency: TickParam;
  #states: TickSourceStateEvent[] = [{ state: "stopped", time: 0 }];
  #offsets: TickSourceOffsetEvent[];
  #disposed = false;

  constructor(options: TickSourceOptions = {}) {
    this.frequency = new TickParam(options);
    this.#offsets = [{ ticks: requireFinite(options.offset ?? 0, "offset"), time: 0 }];
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get seconds(): number {
    return this.getSecondsAtTime(0);
  }

  get state(): PlaybackState {
    return this.getStateAtTime(0);
  }

  get ticks(): number {
    return this.getTicksAtTime(0);
  }

  cancel(time: number): this {
    const at = requireFinite(time, "time");
    this.#states = this.#states.filter((event) => event.time < at);
    this.#offsets = this.#offsets.filter((event) => event.time < at);
    this.frequency.cancelScheduledValues(at);

    return this;
  }

  dispose(): void {
    this.#disposed = true;
    this.#states = [];
    this.#offsets = [];
    this.frequency.cancelScheduledValues(0);
  }

  getSecondsAtTime(time: number): number {
    return this.frequency.ticksToTime(this.getTicksAtTime(time), 0);
  }

  getStateAtTime(time: number): PlaybackState {
    const at = requireFinite(time, "time");
    let state: PlaybackState = "stopped";

    for (const event of this.#states) {
      if (event.time > at) {
        break;
      }

      state = event.state;
    }

    return state;
  }

  getTicksAtTime(time: number): number {
    const at = requireFinite(time, "time");

    const events = [
      ...this.#states.map((event) => ({ ...event, kind: "state" as const })),
      ...this.#offsets.map((event) => ({ ...event, kind: "offset" as const })),
    ].toSorted((left, right) => left.time - right.time);

    let state: PlaybackState = "stopped";
    let ticks = 0;
    let segmentTime = 0;

    for (const event of events) {
      if (event.time > at) {
        break;
      }

      if (state === "started") {
        ticks += this.frequency.timeToTicks(event.time - segmentTime, segmentTime);
      }

      segmentTime = event.time;

      if (event.kind === "state") {
        state = event.state;
      } else {
        ticks = event.ticks;
      }
    }

    if (state === "started") {
      ticks += this.frequency.timeToTicks(at - segmentTime, segmentTime);
    }

    return state === "stopped" ? 0 : ticks;
  }

  /**
   * Time at which the counter reaches `tick`, or `Infinity` if it never does.
   */
  getTimeOfTick(tick: number): number {
    const target = requireFinite(tick, "tick");

    for (const state of this.#states) {
      if (state.state !== "started") {
        continue;
      }

      const startTicks =
        lastOffsetAt(this.#offsets, state.time)?.ticks ?? this.getTicksAtTime(state.time);

      if (target < startTicks) {
        continue;
      }

      const time = this.frequency.getTimeOfTick(
        this.frequency.getTicksAtTime(state.time) + target - startTicks,
      );

      const next = this.#states.find((event) => event.time > state.time);

      if (next === undefined || time < next.time) {
        return time;
      }
    }

    return Number.POSITIVE_INFINITY;
  }

  pause(time = 0): this {
    const at = requireFinite(time, "time");

    if (this.getStateAtTime(at) === "started") {
      this.#insertOffset(this.getTicksAtTime(at), at);
      this.#insertState("paused", at);
    }

    return this;
  }

  setSecondsAtTime(seconds: number, time: number): this {
    this.#insertOffset(this.frequency.timeToTicks(requireFinite(seconds, "seconds"), time), time);

    return this;
  }

  setTicksAtTime(ticks: number, time: number): this {
    this.#insertOffset(ticks, time);

    return this;
  }

  start(time = 0, offset?: number): this {
    const at = requireFinite(time, "time");

    if (this.getStateAtTime(at) !== "started") {
      if (offset !== undefined) {
        this.#insertOffset(offset, at);
      }

      this.#insertState("started", at);
    }

    return this;
  }

  stop(time = 0): this {
    const at = requireFinite(time, "time");
    this.#insertState("stopped", at);
    this.#insertOffset(0, at);

    return this;
  }

  #insertState(state: PlaybackState, time: number): void {
    const at = requireFinite(time, "time");
    this.#states = this.#states.filter((event) => event.time !== at);
    this.#states.push({ state, time: at });
    this.#states.sort((left, right) => left.time - right.time);
  }

  #insertOffset(ticks: number, time: number): void {
    const at = requireFinite(time, "time");
    this.#offsets = this.#offsets.filter((event) => event.time !== at);
    this.#offsets.push({ ticks: requireFinite(ticks, "ticks"), time: at });
    this.#offsets.sort((left, right) => left.time - right.time);
  }
}

function integrateTickSegment(
  event: TickEvent,
  after: TickEvent | undefined,
  time: number,
): number {
  const endTime = after === undefined ? time : Math.min(time, after.time);
  const duration = endTime - event.time;

  if (duration <= 0) {
    return 0;
  }

  if (after?.kind === "linear" && endTime <= after.time) {
    const progress = duration / (after.time - event.time);
    const endRate = event.rate + (after.rate - event.rate) * progress;

    return duration * (event.rate + endRate) * 0.5;
  }

  return duration * event.rate;
}

function invertTickSegment(event: TickEvent, after: TickEvent | undefined, tick: number): number {
  const deltaTicks = tick - event.ticks;

  if (deltaTicks <= 0) {
    return event.time;
  }

  if (after?.kind === "linear" && after.time > event.time) {
    const duration = after.time - event.time;
    const slope = (after.rate - event.rate) / duration;

    if (Math.abs(slope) < 1e-12) {
      return event.rate === 0 ? Number.POSITIVE_INFINITY : event.time + deltaTicks / event.rate;
    }

    const discriminant = event.rate * event.rate + 2 * slope * deltaTicks;

    if (discriminant < 0) {
      return Number.POSITIVE_INFINITY;
    }

    const root = (-event.rate + Math.sqrt(discriminant)) / slope;

    if (root >= 0 && root <= duration) {
      return event.time + root;
    }
  }

  if (event.rate === 0) {
    return Number.POSITIVE_INFINITY;
  }

  return event.time + deltaTicks / event.rate;
}

function lastOffsetAt(
  offsets: readonly TickSourceOffsetEvent[],
  time: number,
): TickSourceOffsetEvent | undefined {
  let match: TickSourceOffsetEvent | undefined;

  for (const event of offsets) {
    if (event.time > time) {
      break;
    }

    match = event;
  }

  return match;
}
