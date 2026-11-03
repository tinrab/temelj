import { describe, expect, it, vi } from "vitest";

import { MockClockContext } from "../../tests/audio.ts";
import {
  AudioDisposedError,
  Clock,
  Scheduler,
  type ClockCallback,
  type SchedulerCallback,
  type SchedulerTimer,
} from "../mod.ts";

function createMockContext(currentTime = 0): MockClockContext {
  return new MockClockContext(currentTime);
}

describe("Scheduler", () => {
  it("schedules one-shot callbacks in time order", () => {
    const context = createMockContext();
    const scheduler = new Scheduler({ context, lookAhead: 0 });
    const calls: number[] = [];

    scheduler.schedule((time) => calls.push(time), 2);
    scheduler.schedule((time) => calls.push(time), 1);
    scheduler.flush(1.5);

    expect(calls).toEqual([1]);
    expect(scheduler.eventCount).toBe(1);

    scheduler.flush(2);

    expect(calls).toEqual([1, 2]);
    expect(scheduler.eventCount).toBe(0);
  });

  it("resolves relative and musical time expressions", () => {
    const context = createMockContext(10);
    const scheduler = new Scheduler({ bpm: 120, context });

    expect(scheduler.toSeconds("+0.5")).toBe(10.5);
    expect(scheduler.toSeconds("4n")).toBe(0.5);
    expect(scheduler.toSeconds("8t")).toBeCloseTo(1 / 6, 12);
    expect(scheduler.toSeconds("0:2:0")).toBe(1);
    expect(scheduler.toSeconds("192i")).toBe(0.5);
    expect(scheduler.toSeconds("2m")).toBe(4);

    scheduler.ppq = 384;

    expect(scheduler.toSeconds("192i")).toBe(0.25);

    scheduler.timeSignature = [6, 8];

    expect(scheduler.toSeconds("2m")).toBe(3);
    expect(scheduler.toSeconds("1:2")).toBe(2.5);
  });

  it("flushes through context now plus lookAhead by default", () => {
    const context = createMockContext(1);
    const scheduler = new Scheduler({ context, lookAhead: 0.2 });
    const callback = vi.fn<SchedulerCallback>();

    scheduler.schedule(callback, 1.25);
    scheduler.flush();

    expect(callback).toHaveBeenCalledWith(1.25, expect.objectContaining({ time: 1.25 }));
  });

  it("schedules repeating callbacks and preserves the event id", () => {
    const scheduler = new Scheduler({ context: createMockContext(), lookAhead: 0 });
    const calls: Array<{ id: number; time: number }> = [];

    const id = scheduler.scheduleRepeat(
      (time, event) => {
        calls.push({ id: event.id, time });
      },
      0.5,
      1,
    );

    scheduler.flush(2);

    expect(calls).toEqual([
      { id, time: 1 },
      { id, time: 1.5 },
      { id, time: 2 },
    ]);
    expect(scheduler.eventCount).toBe(1);
  });

  it("cancels scheduled callbacks", () => {
    const scheduler = new Scheduler({ context: createMockContext() });
    const callback = vi.fn<SchedulerCallback>();
    const id = scheduler.schedule(callback, 1);

    expect(scheduler.cancel(id)).toBe(true);
    expect(scheduler.cancel(id)).toBe(false);

    scheduler.flush(2);

    expect(callback).not.toHaveBeenCalled();
  });

  it("honors cancellation at an exact event boundary while flushing", () => {
    const scheduler = new Scheduler({ context: createMockContext() });
    const cancelled = vi.fn<SchedulerCallback>();
    let cancelledId = -1;

    const canceller = vi.fn<SchedulerCallback>(() => {
      scheduler.cancel(cancelledId);
    });

    scheduler.schedule(canceller, 1);
    cancelledId = scheduler.schedule(cancelled, 1);
    scheduler.flush(1);

    expect(canceller).toHaveBeenCalledOnce();
    expect(cancelled).not.toHaveBeenCalled();
    expect(scheduler.eventCount).toBe(0);
  });

  it("flushes callbacks nested from scheduled callbacks within the same horizon", () => {
    const scheduler = new Scheduler({ context: createMockContext() });
    const calls: string[] = [];

    scheduler.schedule(() => {
      calls.push("outer");
      scheduler.schedule(() => calls.push("nested"), 1);
    }, 1);

    scheduler.flush(1);

    expect(calls).toEqual(["outer", "nested"]);
    expect(scheduler.eventCount).toBe(0);
  });

  it("cancels every queued callback with cancelAll", () => {
    const scheduler = new Scheduler({ context: createMockContext() });
    const callback = vi.fn<SchedulerCallback>();

    scheduler.schedule(callback, 1);
    scheduler.scheduleRepeat(callback, 0.25, 1.25);
    scheduler.cancelAll();
    scheduler.flush(2);

    expect(callback).not.toHaveBeenCalled();
    expect(scheduler.eventCount).toBe(0);
  });

  it("starts and stops the timer loop", () => {
    const callback = vi.fn<SchedulerCallback>();
    const clearTimeout = vi.fn<(timer: SchedulerTimer) => void>();

    const setTimeout = vi.fn<(callback: () => void, delay: number) => SchedulerTimer>(
      (_callback, _delay) => 123,
    );

    const scheduler = new Scheduler({
      clearTimeout,
      context: createMockContext(),
      intervalSeconds: 0.05,
      setTimeout,
    });

    scheduler.schedule(callback, 0);
    expect(scheduler.state).toBe("stopped");

    scheduler.start();

    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 50);
    expect(scheduler.isRunning).toBe(true);
    expect(scheduler.state).toBe("started");

    const tick = setTimeout.mock.calls[0]?.[0];
    expect(tick).toBeTypeOf("function");
    tick?.();

    expect(callback).toHaveBeenCalled();
    expect(setTimeout).toHaveBeenCalledTimes(2);

    scheduler.stop();

    expect(clearTimeout).toHaveBeenCalled();
    expect(scheduler.isRunning).toBe(false);
    expect(scheduler.state).toBe("stopped");
  });

  it("keeps the timer loop running when a callback throws", () => {
    const setTimeout = vi.fn<(callback: () => void, delay: number) => SchedulerTimer>(() => 1);
    const later = vi.fn<SchedulerCallback>();

    const scheduler = new Scheduler({
      clearTimeout: vi.fn<(timer: SchedulerTimer) => void>(),
      context: createMockContext(),
      setTimeout,
    });

    scheduler.schedule(() => {
      throw new Error("callback failed");
    }, 0);
    scheduler.start();

    expect(() => setTimeout.mock.calls[0]?.[0]()).toThrow("callback failed");
    expect(setTimeout).toHaveBeenCalledTimes(2);

    scheduler.schedule(later, 0);
    setTimeout.mock.calls[1]?.[0]();
    expect(later).toHaveBeenCalled();
  });

  it("rejects invalid repeat intervals and disposed use", () => {
    const scheduler = new Scheduler({ context: createMockContext() });

    expect(scheduler.disposed).toBe(false);
    expect(scheduler.state).toBe("stopped");
    expect(() => scheduler.scheduleRepeat(() => undefined, 0)).toThrow(RangeError);

    scheduler.dispose();
    scheduler.dispose();

    expect(scheduler.disposed).toBe(true);
    expect(scheduler.state).toBe("stopped");
    expect(() => scheduler.schedule(() => undefined, 1)).toThrow(AudioDisposedError);
    expect(() => scheduler.flush()).toThrow(AudioDisposedError);
  });

  it("validates mutable scheduler timing settings", () => {
    const scheduler = new Scheduler({ context: createMockContext() });

    scheduler.bpm = 90;
    scheduler.lookAhead = 0.25;
    scheduler.ppq = 96;
    scheduler.timeSignature = 3;

    expect(scheduler.bpm).toBe(90);
    expect(scheduler.lookAhead).toBe(0.25);
    expect(scheduler.ppq).toBe(96);
    expect(scheduler.timeSignature).toBe(3);
    expect(() => {
      scheduler.bpm = 0;
    }).toThrow(RangeError);
    expect(() => {
      scheduler.lookAhead = -1;
    }).toThrow(RangeError);
    expect(() => {
      scheduler.ppq = 0;
    }).toThrow(RangeError);
    expect(() => {
      scheduler.timeSignature = [6, 0];
    }).toThrow(RangeError);
  });
});

describe("Clock", () => {
  it("invokes callbacks at the configured frequency and tracks ticks", () => {
    const context = createMockContext(0);
    const callback = vi.fn<ClockCallback>();
    const clock = new Clock({ callback, context, frequency: 2, lookAhead: 0 });

    expect(clock).toBeInstanceOf(Clock);
    expect(clock.disposed).toBe(false);
    expect(clock.state).toBe("stopped");
    expect(clock.frequency).toBe(2);

    clock.start(1, 4);
    clock.flush(2);

    expect(clock.state).toBe("started");
    expect(callback.mock.calls).toEqual([
      [1, 4],
      [1.5, 5],
      [2, 6],
    ]);
    expect(clock.ticks).toBe(7);
    expect(clock.seconds).toBe(3.5);
  });

  it("pauses without resetting ticks and stops with a reset", () => {
    const context = createMockContext(0);
    const callback = vi.fn<ClockCallback>();
    const clock = new Clock({ callback, context, frequency: 4, lookAhead: 0 });

    clock.start(0);
    clock.flush(0.25);
    clock.pause();
    clock.flush(1);

    expect(clock.state).toBe("paused");
    expect(callback).toHaveBeenCalledTimes(2);
    expect(clock.ticks).toBe(2);

    clock.start(1);
    clock.flush(1.25);

    expect(callback.mock.calls.slice(-2)).toEqual([
      [1, 2],
      [1.25, 3],
    ]);

    clock.stop();

    expect(clock.state).toBe("stopped");
    expect(clock.ticks).toBe(0);
  });

  it("reschedules active ticks when frequency changes", () => {
    const context = createMockContext(0);
    const callback = vi.fn<ClockCallback>();
    const clock = new Clock({ callback, context, frequency: 1, lookAhead: 0 });

    clock.start(0);
    clock.flush(0);
    context.currentTime = 0.25;
    clock.frequency = 4;
    clock.flush(0.75);

    expect(callback.mock.calls).toEqual([
      [0, 0],
      [0.25, 1],
      [0.5, 2],
      [0.75, 3],
    ]);
  });

  it("exposes tick and second helpers", () => {
    const context = createMockContext(10);
    const clock = new Clock({ context, frequency: 2, ticks: 4 });

    expect(clock.seconds).toBe(2);

    clock.seconds = 3.8;
    expect(clock.ticks).toBe(7);
    expect(clock.getTimeOfTick(9, 10)).toBe(11);
    expect(clock.nextTickTime(2, 10)).toBe(11);

    clock.setTicksAtTime(12, 11);
    clock.flush(11);
    expect(clock.ticks).toBe(12);

    expect(() => {
      clock.frequency = 0;
    }).toThrow(RangeError);
    expect(() => {
      clock.ticks = -1;
    }).toThrow(RangeError);
    expect(() => {
      clock.seconds = -1;
    }).toThrow(RangeError);
  });

  it("exposes clock disposal state", () => {
    const clock = new Clock({ context: createMockContext() });

    expect(clock.disposed).toBe(false);

    clock.dispose();
    clock.dispose();

    expect(clock.disposed).toBe(true);
    expect(() => clock.flush()).toThrow(AudioDisposedError);
  });
});
