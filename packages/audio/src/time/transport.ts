import type { PubSub, Unsubscribe } from "@temelj/event";

import { createPubSub } from "@temelj/event";
import { isNumber } from "@temelj/value";

import type { AudioSignal } from "../signal/param-signal.ts";
import type { ParamUnit } from "../signal/param.ts";
import type { PlaybackState } from "../unit.ts";
import type { SchedulerEventId, SchedulerOptions } from "./scheduler.ts";
import type { TimeExpression, TimeSignatureExpression } from "./time.ts";

import { AudioRangeError } from "../errors.ts";
import { clampNormal, requireNonNegative, requirePositive } from "../validation.ts";
import { Scheduler } from "./scheduler.ts";
import { ticksToBarsBeatsSixteenths } from "./time.ts";

export type TransportEventId = number;

export type TransportEvent = {
  readonly id: TransportEventId;
  readonly interval?: number;
  readonly position: number;
};

export type TransportCallback = (time: number, event: TransportEvent) => void;

export type TransportEvents = {
  readonly loop: { readonly time: number };
  readonly loopEnd: { readonly time: number };
  readonly loopStart: { readonly time: number; readonly position: number };
  readonly pause: { readonly position: number };
  readonly start: { readonly position: number };
  readonly stop: { readonly position: number };
};

export type TransportStartOptions = {
  /**
   * Context time to start at. Defaults to now.
   */
  readonly time?: TimeExpression;
  /**
   * Transport position to start from. Defaults to the current position.
   */
  readonly position?: TimeExpression;
};

export type TransportScheduleOptions = {
  readonly time?: TimeExpression;
};

export type TransportEventName = keyof TransportEvents;

export type TransportSyncedSource = {
  start(time?: number, offset?: number, duration?: number): void;
  stop(time?: number): void;
};

export type TransportSyncSourceOptions = {
  readonly duration?: TimeExpression;
  readonly offset?: TimeExpression;
  readonly position?: TimeExpression;
};

export type TransportOptions = SchedulerOptions & {
  readonly loop?: boolean;
  readonly loopEnd?: TimeExpression;
  readonly loopStart?: TimeExpression;
  readonly position?: TimeExpression;
  readonly swing?: number;
  readonly swingSubdivision?: TimeExpression;
};

type TimelineEvent = {
  callback: TransportCallback;
  duration?: number;
  id: TransportEventId;
  interval?: number;
  originalDuration?: TimeExpression;
  originalInterval?: TimeExpression;
  originalPosition: TimeExpression;
  position: number;
  schedulerId?: SchedulerEventId;
};

type SyncedSignalEvent = {
  initial: number;
  ratio: number;
  signal: AudioSignal<ParamUnit>;
};

type SyncedSourceEvent = {
  source: TransportSyncedSource;
  startId: TransportEventId;
  stopId?: TransportEventId;
  unsubscribe: Unsubscribe;
};

function secondsToTicks(seconds: number, bpm: number, ppq: number): number {
  return (seconds / (60 / bpm)) * ppq;
}

/**
 * Musical timeline driven by a `Scheduler`. It keeps the position in ticks and runs callbacks
 * scheduled in musical time. `syncSignal()` and `syncSource()` make signals and sources follow its
 * tempo.
 */
export class Transport {
  readonly #notifier: PubSub<TransportEvents> = createPubSub<TransportEvents>();
  #events: TimelineEvent[] = [];
  #loop: boolean;
  #loopEnd: TimeExpression;
  #loopSchedulerId: SchedulerEventId | undefined;
  #loopStart: TimeExpression;
  #nextId = 1;
  #position: number;
  #scheduler: Scheduler;
  #startContextTime = 0;
  #startPosition = 0;
  #state: PlaybackState = "stopped";
  #swing: number;
  #swingSubdivision: TimeExpression;
  #syncedSignals: SyncedSignalEvent[] = [];
  #syncedSources: SyncedSourceEvent[] = [];

  constructor(options: TransportOptions) {
    this.#scheduler = new Scheduler(options);
    this.#loop = options.loop ?? false;
    this.#loopStart = options.loopStart ?? 0;
    this.#loopEnd = options.loopEnd ?? "1m";
    this.#swing = clampNormal(options.swing ?? 0, "swing");
    this.#swingSubdivision = options.swingSubdivision ?? "8n";
    this.#position = requireNonNegative(
      options.position === undefined ? 0 : this.#scheduler.toSeconds(options.position),
      "position",
    );
  }

  get bpm(): number {
    return this.#scheduler.bpm;
  }

  get barsBeatsSixteenths(): string {
    return ticksToBarsBeatsSixteenths(this.ticks, {
      ppq: this.ppq,
      timeSignature: this.timeSignature,
    });
  }

  get disposed(): boolean {
    return this.#scheduler.disposed;
  }

  get eventCount(): number {
    return this.#events.length;
  }

  get loop(): boolean {
    return this.#loop;
  }

  get loopEnd(): TimeExpression {
    return this.#loopEnd;
  }

  get loopStart(): TimeExpression {
    return this.#loopStart;
  }

  get position(): number {
    if (this.#state !== "started") {
      return this.#position;
    }

    const elapsed =
      this.#startPosition + Math.max(0, this.#scheduler.immediate - this.#startContextTime);

    return this.#wrapPosition(elapsed);
  }

  get ppq(): number {
    return this.#scheduler.ppq;
  }

  get scheduler(): Scheduler {
    return this.#scheduler;
  }

  get state(): PlaybackState {
    return this.#state;
  }

  get swing(): number {
    return this.#swing;
  }

  get swingSubdivision(): TimeExpression {
    return this.#swingSubdivision;
  }

  get progress(): number {
    if (!this.#loop) {
      return 0;
    }

    const { end, start } = this.#loopBounds();

    return Math.min(1, Math.max(0, (this.position - start) / (end - start)));
  }

  get seconds(): number {
    return this.position;
  }

  get ticks(): number {
    return secondsToTicks(this.position, this.bpm, this.ppq);
  }

  get timeSignature(): TimeSignatureExpression {
    return this.#scheduler.timeSignature;
  }

  setBpm(bpm: number): void {
    this.#scheduler.bpm = bpm;
    this.#refreshSyncedSignals();
    this.#refreshEventSchedule();
  }

  setLoop(loop: boolean): void {
    this.#loop = loop;
    this.#refreshEventSchedule();
  }

  setPpq(ppq: number): void {
    this.#scheduler.ppq = ppq;
    this.#refreshEventSchedule();
  }

  setSwing(swing: number): void {
    this.#swing = clampNormal(swing, "swing");
  }

  setSwingSubdivision(subdivision: TimeExpression): void {
    requirePositive(this.#scheduler.toSeconds(subdivision), "swingSubdivision");
    this.#swingSubdivision = subdivision;
  }

  setTimeSignature(timeSignature: TimeSignatureExpression): void {
    this.#scheduler.timeSignature = timeSignature;
    this.#refreshEventSchedule();
  }

  cancel(id: TransportEventId): boolean {
    const event = this.#events.find((entry) => entry.id === id);

    if (!event) {
      return false;
    }

    if (isNumber(event.schedulerId)) {
      this.#scheduler.cancel(event.schedulerId);
    }

    this.#events = this.#events.filter((entry) => entry !== event);

    return true;
  }

  cancelAfter(position: TimeExpression = 0): this {
    const resolvedPosition = requireNonNegative(this.#scheduler.toSeconds(position), "position");

    for (const event of this.#events.slice()) {
      if (event.position >= resolvedPosition) {
        this.cancel(event.id);
      }
    }

    return this;
  }

  cancelAll(): void {
    this.#clearScheduledEvents();
    this.#events = [];
  }

  dispose(): void {
    this.cancelAll();

    for (const synced of this.#syncedSources.slice()) {
      synced.source.stop(this.#scheduler.immediate);
      this.unsyncSource(synced.source);
    }

    for (const synced of this.#syncedSignals.slice()) {
      this.unsyncSignal(synced.signal);
    }

    this.#notifier.clear();
    this.#scheduler.dispose();
    this.#state = "stopped";
  }

  flush(until?: TimeExpression): void {
    this.#scheduler.flush(until);
  }

  pause({ time }: TransportScheduleOptions = {}): this {
    this.#at(time, (at) => {
      if (this.#state === "started") {
        this.#pauseAtContextTime(at);
      }
    });

    return this;
  }

  #pauseAtContextTime(time: number): void {
    this.#position = this.#wrapPosition(this.#rawPositionAtTime(time));
    this.#clearScheduledEvents();
    this.#clearScheduledLoop();
    this.#scheduler.stop();
    this.#state = "paused";
    this.#notifier.emit("pause", { position: this.#position });
  }

  schedule(callback: TransportCallback, position: TimeExpression): TransportEventId {
    return this.#addEvent(callback, position);
  }

  scheduleOnce(callback: TransportCallback, position: TimeExpression): TransportEventId {
    return this.schedule((time, event) => {
      callback(time, event);
      this.cancel(event.id);
    }, position);
  }

  scheduleRepeat(
    callback: TransportCallback,
    interval: TimeExpression,
    startPosition: TimeExpression = 0,
    duration?: TimeExpression,
  ): TransportEventId {
    const resolvedInterval = this.#scheduler.toSeconds(interval);

    requirePositive(resolvedInterval, "interval");

    const resolvedDuration =
      duration === undefined ? undefined : this.#scheduler.toSeconds(duration);

    if (resolvedDuration !== undefined) {
      requirePositive(resolvedDuration, "duration");
    }

    return this.#addEvent(callback, startPosition, resolvedInterval, interval, duration);
  }

  setLoopPoints(start: TimeExpression, end: TimeExpression): this {
    this.#loopStart = start;
    this.#loopEnd = end;
    this.#refreshEventSchedule();

    return this;
  }

  seek(position: TimeExpression, { time }: TransportScheduleOptions = {}): this {
    const resolvedPosition = this.#resolvePosition(position);
    this.#at(time, (at) => {
      this.#seekToPosition(resolvedPosition, at);
    });

    return this;
  }

  #seekToPosition(resolvedPosition: number, contextTime: number): void {
    this.#position = resolvedPosition;

    if (this.#state === "started") {
      this.#clearScheduledEvents();
      this.#clearScheduledLoop();
      this.#startPosition = resolvedPosition;
      this.#startContextTime = contextTime;
      this.#scheduleEventsFrom(resolvedPosition);
      this.#scheduleLoopEventsFrom(resolvedPosition);
    }
  }

  start({ position, time }: TransportStartOptions = {}): this {
    const resolvedPosition = position === undefined ? undefined : this.#resolvePosition(position);
    this.#at(time, (at) => {
      this.#startFromPosition(resolvedPosition ?? this.#position, at);
    });

    return this;
  }

  #startFromPosition(resolvedPosition: number, contextTime: number): void {
    this.#clearScheduledEvents();
    this.#clearScheduledLoop();
    this.#position = resolvedPosition;
    this.#startPosition = resolvedPosition;
    this.#startContextTime = contextTime;
    this.#state = "started";
    this.#scheduleEventsFrom(resolvedPosition);
    this.#scheduleLoopEventsFrom(resolvedPosition);
    this.#scheduler.start();
    this.#notifier.emit("start", { position: resolvedPosition });
  }

  /**
   * Stops and rewinds to `position` (default 0).
   */
  stop({ position = 0, time }: TransportStartOptions = {}): this {
    const resolvedPosition = this.#resolvePosition(position);
    this.#at(time, () => {
      this.#position = resolvedPosition;
      this.#clearScheduledEvents();
      this.#clearScheduledLoop();
      this.#scheduler.stop();
      this.#state = "stopped";
      this.#notifier.emit("stop", { position: this.#position });
    });

    return this;
  }

  /**
   * Stops when started, otherwise starts.
   */
  toggle(options: TransportStartOptions = {}): this {
    const resolvedPosition =
      options.position === undefined ? undefined : this.#resolvePosition(options.position);

    this.#at(options.time, (at) => {
      if (this.#state === "started") {
        this.stop({ position: resolvedPosition ?? 0 });
      } else {
        this.#startFromPosition(resolvedPosition ?? this.#position, at);
      }
    });

    return this;
  }

  /**
   * Runs `action` now, or at context time `time` through the scheduler.
   */
  #at(time: TimeExpression | undefined, action: (time: number) => void): void {
    if (time === undefined) {
      action(this.#scheduler.immediate);

      return;
    }

    this.#scheduler.schedule(action, this.#scheduler.toSeconds(time));
  }

  #resolvePosition(position: TimeExpression): number {
    return requireNonNegative(this.#scheduler.toSeconds(position), "position");
  }

  toSeconds(time: TimeExpression): number {
    return this.#scheduler.toSeconds(time);
  }

  toTicks(time: TimeExpression): number {
    return secondsToTicks(this.toSeconds(time), this.bpm, this.ppq);
  }

  toBarsBeatsSixteenths(time: TimeExpression): string {
    return ticksToBarsBeatsSixteenths(this.toTicks(time), {
      ppq: this.ppq,
      timeSignature: this.timeSignature,
    });
  }

  getSecondsAtTime(time: TimeExpression): number {
    if (this.#state !== "started") {
      return this.position;
    }

    return this.#wrapPosition(this.#rawPositionAtTime(this.#scheduler.toSeconds(time)));
  }

  getTicksAtTime(time: TimeExpression = this.#scheduler.immediate): number {
    return secondsToTicks(this.getSecondsAtTime(time), this.bpm, this.ppq);
  }

  getTimeOfTick(tick: number, before: TimeExpression = this.#scheduler.immediate): number {
    const resolvedTick = requireNonNegative(tick, "ticks");
    const resolvedBefore = this.#scheduler.toSeconds(before);
    const deltaTicks = resolvedTick - this.getTicksAtTime(resolvedBefore);

    return resolvedBefore + this.#scheduler.toSeconds(`${deltaTicks}i`);
  }

  nextTickTime(offset: number, when: TimeExpression = this.#scheduler.immediate): number {
    requireNonNegative(offset, "offset");

    return this.getTimeOfTick(this.getTicksAtTime(when) + offset, when);
  }

  /**
   * Transport lifecycle and loop events. Handler failures are collected by the emitter and do not
   * interrupt scheduling.
   */
  get events(): PubSub<TransportEvents> {
    return this.#notifier;
  }

  nextSubdivision(subdivision: TimeExpression = "4n"): number {
    if (this.#state !== "started") {
      return 0;
    }

    const subdivisionTicks = this.toTicks(subdivision);

    requirePositive(subdivisionTicks, "subdivision");

    const now = this.#scheduler.now;
    const position = this.#wrapPosition(this.#rawPositionAtTime(now));
    const currentTicks = secondsToTicks(position, this.bpm, this.ppq);
    const remainder = currentTicks % subdivisionTicks;
    const remainingTicks = remainder === 0 ? subdivisionTicks : subdivisionTicks - remainder;

    return now + this.#scheduler.toSeconds(`${remainingTicks}i`);
  }

  syncSignal(signal: AudioSignal<ParamUnit>, ratio?: number): this {
    this.unsyncSignal(signal);

    const initial = signal.value;

    const resolvedRatio =
      isNumber(ratio) && Number.isFinite(ratio) ? ratio : this.#getSignalRatio(signal);

    this.#syncedSignals.push({
      initial,
      ratio: resolvedRatio,
      signal,
    });
    signal.setValueAtTime(this.bpm * resolvedRatio, this.#scheduler.immediate);

    return this;
  }

  unsyncSignal(signal: AudioSignal<ParamUnit>): this {
    for (let i = this.#syncedSignals.length - 1; i >= 0; i--) {
      const synced = this.#syncedSignals[i];

      if (synced?.signal !== signal) {
        continue;
      }

      signal.setValueAtTime(synced.initial, this.#scheduler.immediate);
      this.#syncedSignals.splice(i, 1);
    }

    return this;
  }

  refreshSyncedSignals(): this {
    this.#refreshSyncedSignals();

    return this;
  }

  syncSource(source: TransportSyncedSource, options: TransportSyncSourceOptions = {}): this {
    this.unsyncSource(source);

    const position = options.position ?? 0;

    const offset =
      options.offset === undefined ? undefined : this.#scheduler.toSeconds(options.offset);

    const duration =
      options.duration === undefined
        ? undefined
        : requirePositive(this.#scheduler.toSeconds(options.duration), "duration");

    const startPosition = this.#scheduler.toSeconds(position);

    const startId = this.schedule((time) => {
      source.start(time, offset, duration);
    }, position);

    const stopId = isNumber(duration)
      ? this.schedule((time) => {
          source.stop(time);
        }, startPosition + duration)
      : undefined;

    const stop = (): void => {
      source.stop(this.#scheduler.immediate);
    };

    const unsubscribeStop = this.#notifier.on("stop", stop);
    const unsubscribePause = this.#notifier.on("pause", stop);
    this.#syncedSources.push({
      source,
      startId,
      stopId,
      unsubscribe: () => {
        unsubscribeStop();
        unsubscribePause();
      },
    });

    return this;
  }

  unsyncSource(source: TransportSyncedSource): this {
    for (let index = this.#syncedSources.length - 1; index >= 0; index--) {
      const synced = this.#syncedSources[index];

      if (synced?.source !== source) {
        continue;
      }

      this.cancel(synced.startId);

      if (isNumber(synced.stopId)) {
        this.cancel(synced.stopId);
      }

      synced.unsubscribe();
      this.#syncedSources.splice(index, 1);
    }

    return this;
  }

  #getSignalRatio(signal: AudioSignal<ParamUnit>): number {
    if (this.bpm === 0) {
      return 0;
    }

    return signal.value / this.bpm;
  }

  #refreshSyncedSignals(): void {
    for (const synced of this.#syncedSignals) {
      synced.signal.setValueAtTime(this.bpm * synced.ratio, this.#scheduler.immediate);
    }
  }

  #refreshEventSchedule(): void {
    this.#recalculateEventPositions();

    if (this.#state === "started") {
      const position = this.position;
      this.#clearScheduledEvents();
      this.#clearScheduledLoop();
      this.#startPosition = position;
      this.#startContextTime = this.#scheduler.immediate;
      this.#scheduleEventsFrom(position);
      this.#scheduleLoopEventsFrom(position);
    }
  }

  #addEvent(
    callback: TransportCallback,
    position: TimeExpression,
    interval?: number,
    originalInterval?: TimeExpression,
    originalDuration?: TimeExpression,
  ): TransportEventId {
    const id = this.#nextId;
    this.#nextId += 1;

    const event: TimelineEvent = {
      callback,
      duration:
        originalDuration === undefined
          ? undefined
          : requirePositive(this.#scheduler.toSeconds(originalDuration), "duration"),
      id,
      interval,
      originalDuration,
      originalInterval,
      originalPosition: position,
      position: requireNonNegative(this.#scheduler.toSeconds(position), "position"),
    };

    this.#events.push(event);
    this.#events.sort((left, right) => left.position - right.position || left.id - right.id);

    if (this.#state === "started") {
      this.#scheduleEvent(event, this.position);
    }

    return id;
  }

  #clearScheduledEvents(): void {
    for (const event of this.#events) {
      if (isNumber(event.schedulerId)) {
        this.#scheduler.cancel(event.schedulerId);
        event.schedulerId = undefined;
      }
    }
  }

  #clearScheduledLoop(): void {
    if (isNumber(this.#loopSchedulerId)) {
      this.#scheduler.cancel(this.#loopSchedulerId);
      this.#loopSchedulerId = undefined;
    }
  }

  #scheduleEvent(event: TimelineEvent, fromPosition: number): void {
    if (this.#loop) {
      this.#scheduleLoopedEvent(event, fromPosition);

      return;
    }

    if (isNumber(event.interval)) {
      const interval = event.interval;
      const offset = Math.max(0, Math.ceil((fromPosition - event.position) / interval));
      const nextPosition = event.position + offset * interval;
      const startTime = this.#scheduler.immediate + Math.max(0, nextPosition - fromPosition);
      event.schedulerId = this.#scheduler.scheduleRepeat(
        (time) => {
          const position = nextPosition + (time - startTime);

          if (!this.#isRepeatInDuration(event, position)) {
            return;
          }

          event.callback(this.#swingTime(time, position), {
            id: event.id,
            interval,
            position,
          });
        },
        interval,
        startTime,
      );

      return;
    }

    if (event.position < fromPosition) {
      return;
    }

    event.schedulerId = this.#scheduler.schedule(
      (time) =>
        event.callback(this.#swingTime(time, event.position), {
          id: event.id,
          position: event.position,
        }),
      this.#scheduler.immediate + (event.position - fromPosition),
    );
  }

  #scheduleLoopedEvent(event: TimelineEvent, fromPosition: number): void {
    const { end, start } = this.#loopBounds();
    const duration = end - start;

    if (isNumber(event.interval)) {
      const interval = event.interval;
      event.schedulerId = this.#scheduler.scheduleRepeat(
        (time) => {
          const rawPosition = this.#rawPositionAtTime(time);
          const position = this.#wrapPosition(rawPosition);

          if (
            this.#isRepeatOccurrenceInLoop(event, position) &&
            this.#isRepeatInDuration(event, position)
          ) {
            event.callback(this.#swingTime(time, position), { id: event.id, interval, position });
          }
        },
        interval,
        this.#scheduler.immediate,
      );

      return;
    }

    if (event.position < start || event.position >= end) {
      return;
    }

    const rawPosition = this.#rawPositionFromWrappedPosition(event.position, fromPosition);
    const startTime = this.#scheduler.immediate + Math.max(0, rawPosition - fromPosition);
    event.schedulerId = this.#scheduler.scheduleRepeat(
      (time) =>
        event.callback(this.#swingTime(time, event.position), {
          id: event.id,
          position: event.position,
        }),
      duration,
      startTime,
    );
  }

  #scheduleEventsFrom(position: number): void {
    for (const event of this.#events) {
      this.#scheduleEvent(event, position);
    }
  }

  #scheduleLoopEventsFrom(fromPosition: number): void {
    if (!this.#loop) {
      return;
    }

    const { end, start } = this.#loopBounds();
    const duration = end - start;
    const rawEnd = this.#rawPositionFromWrappedPosition(end, fromPosition);
    const startTime = this.#scheduler.immediate + Math.max(0, rawEnd - fromPosition);

    this.#loopSchedulerId = this.#scheduler.scheduleRepeat(
      (time) => {
        this.#notifier.emit("loopEnd", { time });
        this.#notifier.emit("loopStart", { position: start, time });
        this.#notifier.emit("loop", { time });
      },
      duration,
      startTime,
    );
  }

  #recalculateEventPositions(): void {
    for (const event of this.#events) {
      event.position = requireNonNegative(
        this.#scheduler.toSeconds(event.originalPosition),
        "position",
      );

      if (event.originalInterval !== undefined) {
        const interval = this.#scheduler.toSeconds(event.originalInterval);

        requirePositive(interval, "interval");

        event.interval = interval;
      }

      if (event.originalDuration !== undefined) {
        event.duration = requirePositive(
          this.#scheduler.toSeconds(event.originalDuration),
          "duration",
        );
      }
    }

    this.#events.sort((left, right) => left.position - right.position || left.id - right.id);
  }

  #swingTime(time: number, position: number): number {
    if (this.#swing === 0) {
      return time;
    }

    const ticks = this.toTicks(position);
    const swingTicks = this.toTicks(this.#swingSubdivision);

    if (ticks % this.ppq === 0 || ticks % (swingTicks * 2) === 0) {
      return time;
    }

    const progress = (ticks % (swingTicks * 2)) / (swingTicks * 2);
    const amount = Math.sin(progress * Math.PI) * this.#swing;

    return time + this.#scheduler.toSeconds(`${(swingTicks * 2) / 3}i`) * amount;
  }

  #loopBounds() {
    const start = requireNonNegative(this.#scheduler.toSeconds(this.#loopStart), "position");
    const end = requireNonNegative(this.#scheduler.toSeconds(this.#loopEnd), "position");

    if (end <= start) {
      AudioRangeError.invalidRange("loop", start, end);
    }

    return { end, start };
  }

  #rawPositionAtTime(time: number): number {
    return this.#startPosition + Math.max(0, time - this.#startContextTime);
  }

  #rawPositionFromWrappedPosition(position: number, fromPosition: number): number {
    const { end, start } = this.#loopBounds();
    const duration = end - start;

    if (fromPosition < position) {
      return position;
    }

    const loops = Math.floor(Math.max(0, fromPosition - start) / duration);
    let rawPosition = position + loops * duration;

    while (rawPosition < fromPosition) {
      rawPosition += duration;
    }

    return rawPosition;
  }

  #wrapPosition(position: number): number {
    if (!this.#loop) {
      return position;
    }

    const { end, start } = this.#loopBounds();

    if (position < end) {
      return position;
    }

    const duration = end - start;

    return start + ((position - start) % duration);
  }

  #isRepeatOccurrenceInLoop(event: TimelineEvent, position: number): boolean {
    const interval = event.interval;

    if (!isNumber(interval)) {
      return false;
    }

    if (position < event.position) {
      return false;
    }

    const occurrences = (position - event.position) / interval;

    return Math.abs(occurrences - Math.round(occurrences)) < 1e-9;
  }

  #isRepeatInDuration(event: TimelineEvent, position: number): boolean {
    return !isNumber(event.duration) || position < event.position + event.duration;
  }
}
