import type { AudioContextLike } from "../context/context.ts";
import type { TimeExpression } from "./time.ts";

import { getAudioContextImmediateTime } from "../context/context.ts";
import { AudioDisposedError } from "../errors.ts";
import { requireNonNegative } from "../validation.ts";
import { toSeconds as parseTimeExpression } from "./time.ts";

export type DrawEventId = number;

export type DrawEvent = {
  readonly id: DrawEventId;
  readonly time: number;
};

export type DrawCallback = (event: DrawEvent) => void;

export type DrawSchedulerOptions = {
  readonly anticipation?: number;
  readonly cancelAnimationFrame?: (id: number) => void;
  readonly context: AudioContextLike;
  readonly expiration?: number;
  readonly requestAnimationFrame?: (callback: FrameRequestCallback) => number;
};

type ScheduledDrawEvent = DrawEvent & {
  callback: DrawCallback;
  canceled: boolean;
};

const DEFAULT_ANTICIPATION = 0.008;

const DEFAULT_EXPIRATION = 0.25;

/**
 * Runs UI callbacks on animation frames at the moment their audio time is reached, so visuals line
 * up with scheduled sound. Callbacks run up to `anticipation` seconds early, and are dropped when
 * they are more than `expiration` seconds late.
 */
export class DrawScheduler {
  #animationFrame: number | undefined;
  #anticipation: number;
  #cancelAnimationFrame: (id: number) => void;
  #context: AudioContextLike;
  #events: ScheduledDrawEvent[] = [];
  #expiration: number;
  #isDisposed = false;
  #nextId = 1;
  #requestAnimationFrame: (callback: FrameRequestCallback) => number;

  constructor(options: DrawSchedulerOptions) {
    this.#context = options.context;
    this.#anticipation = requireNonNegative(
      options.anticipation ?? DEFAULT_ANTICIPATION,
      "anticipation",
    );
    this.#expiration = requireNonNegative(options.expiration ?? DEFAULT_EXPIRATION, "expiration");
    this.#requestAnimationFrame =
      options.requestAnimationFrame ?? ((callback) => globalThis.requestAnimationFrame(callback));
    this.#cancelAnimationFrame =
      options.cancelAnimationFrame ?? ((id) => globalThis.cancelAnimationFrame(id));
  }

  get anticipation(): number {
    return this.#anticipation;
  }

  set anticipation(value: number) {
    this.#anticipation = requireNonNegative(value, "anticipation");
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

  get expiration(): number {
    return this.#expiration;
  }

  set expiration(value: number) {
    this.#expiration = requireNonNegative(value, "expiration");
  }

  get immediate(): number {
    return getAudioContextImmediateTime(this.#context);
  }

  cancel(after: TimeExpression = 0): this {
    this.#assertUsable();
    const resolvedAfter = this.toSeconds(after);

    for (const event of this.#events) {
      if (event.time >= resolvedAfter) {
        event.canceled = true;
      }
    }

    this.#events = this.#events.filter((event) => !event.canceled);
    this.#cancelFrameIfIdle();

    return this;
  }

  cancelId(id: DrawEventId): boolean {
    this.#assertUsable();
    const event = this.#events.find((entry) => entry.id === id);

    if (!event) {
      return false;
    }

    event.canceled = true;
    this.#events = this.#events.filter((entry) => entry !== event);
    this.#cancelFrameIfIdle();

    return true;
  }

  dispose(): void {
    if (this.#isDisposed) {
      return;
    }

    this.#events = [];

    if (this.#animationFrame !== undefined) {
      this.#cancelAnimationFrame(this.#animationFrame);
      this.#animationFrame = undefined;
    }

    this.#isDisposed = true;
  }

  flush(): void {
    this.#assertUsable();
    this.#flushDueEvents();
  }

  schedule(callback: DrawCallback, time: TimeExpression): DrawEventId {
    this.#assertUsable();
    const id = this.#nextId;
    this.#nextId += 1;
    this.#events.push({
      callback,
      canceled: false,
      id,
      time: this.toSeconds(time),
    });
    this.#sortEvents();
    this.#requestFrameIfNeeded();

    return id;
  }

  toSeconds(time: TimeExpression): number {
    return parseTimeExpression(time, {
      now: this.immediate,
    });
  }

  #assertUsable(): void {
    if (this.#isDisposed) {
      AudioDisposedError.disposed("draw scheduler");
    }
  }

  #cancelFrameIfIdle(): void {
    if (this.#events.length === 0 && this.#animationFrame !== undefined) {
      this.#cancelAnimationFrame(this.#animationFrame);
      this.#animationFrame = undefined;
    }
  }

  #flushDueEvents(): void {
    const now = this.immediate;
    const horizon = now + this.#anticipation;
    const due = this.#events.filter((event) => event.time <= horizon);
    this.#events = this.#events.filter((event) => event.time > horizon);

    for (const event of due) {
      if (!event.canceled && now - event.time <= this.#expiration) {
        event.callback({ id: event.id, time: event.time });
      }
    }
  }

  #requestFrameIfNeeded(): void {
    if (this.#animationFrame !== undefined) {
      return;
    }

    this.#animationFrame = this.#requestAnimationFrame(() => {
      this.#animationFrame = undefined;
      this.#flushDueEvents();

      if (this.#events.length > 0) {
        this.#requestFrameIfNeeded();
      }
    });
  }

  #sortEvents(): void {
    this.#events.sort((left, right) => left.time - right.time || left.id - right.id);
  }
}
