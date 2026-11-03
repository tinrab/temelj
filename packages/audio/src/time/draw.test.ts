import { describe, expect, it, vi } from "vitest";

import { MockClockContext } from "../../tests/audio.ts";
import { DrawScheduler, type DrawCallback } from "../mod.ts";

function createMockContext(currentTime = 0): MockClockContext {
  return new MockClockContext(currentTime);
}

type FrameControls = {
  readonly cancelAnimationFrame: ReturnType<typeof vi.fn<(id: number) => void>>;
  readonly frames: FrameRequestCallback[];
  readonly requestAnimationFrame: ReturnType<
    typeof vi.fn<(callback: FrameRequestCallback) => number>
  >;
};

function createFrameControls(): FrameControls {
  const frames: FrameRequestCallback[] = [];

  return {
    cancelAnimationFrame: vi.fn<(id: number) => void>(),
    frames,
    requestAnimationFrame: vi.fn<(callback: FrameRequestCallback) => number>((callback) => {
      frames.push(callback);

      return frames.length;
    }),
  };
}

describe("DrawScheduler", () => {
  it("schedules draw callbacks on animation frames near audio time", () => {
    const context = createMockContext(1);
    const frames = createFrameControls();

    const draw = new DrawScheduler({
      anticipation: 0.01,
      context,
      ...frames,
    });

    const callback = vi.fn<DrawCallback>();

    const id = draw.schedule(callback, 1.005);

    expect(draw.eventCount).toBe(1);
    expect(frames.requestAnimationFrame).toHaveBeenCalledTimes(1);

    frames.frames.shift()?.(0);

    expect(callback).toHaveBeenCalledWith({ id, time: 1.005 });
    expect(draw.eventCount).toBe(0);
  });

  it("preserves time order and skips expired callbacks", () => {
    const context = createMockContext(1);

    const draw = new DrawScheduler({
      anticipation: 0.5,
      context,
      expiration: 0.1,
      ...createFrameControls(),
    });

    const calls: number[] = [];

    draw.schedule((event) => calls.push(event.time), 1.2);
    draw.schedule((event) => calls.push(event.time), 0.8);
    draw.schedule((event) => calls.push(event.time), 1.1);
    draw.flush();

    expect(calls).toEqual([1.1, 1.2]);
    expect(draw.eventCount).toBe(0);
  });

  it("cancels events by time or id", () => {
    const context = createMockContext(1);
    const frames = createFrameControls();

    const draw = new DrawScheduler({
      anticipation: 1,
      context,
      ...frames,
    });

    const callback = vi.fn<DrawCallback>();

    draw.schedule(callback, 1.1);
    const canceled = draw.schedule(callback, 1.2);
    draw.schedule(callback, 1.3);

    expect(draw.cancelId(canceled)).toBe(true);
    draw.cancel(1.25);
    draw.flush();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]?.[0].time).toBe(1.1);
  });

  it("validates mutable timing settings and parses relative times", () => {
    const context = createMockContext(2);

    const draw = new DrawScheduler({
      context,
      ...createFrameControls(),
    });

    draw.anticipation = 0.02;
    draw.expiration = 0.5;

    expect(draw.anticipation).toBe(0.02);
    expect(draw.expiration).toBe(0.5);
    expect(draw.toSeconds("+0.25")).toBe(2.25);
    expect(() => {
      draw.anticipation = -1;
    }).toThrow("anticipation");
    expect(() => {
      draw.expiration = Number.POSITIVE_INFINITY;
    }).toThrow("expiration");
  });

  it("disposes scheduled events and rejects future use", () => {
    const context = createMockContext();
    const frames = createFrameControls();

    const draw = new DrawScheduler({
      context,
      ...frames,
    });

    draw.schedule(() => undefined, 1);
    expect(draw.disposed).toBe(false);

    draw.dispose();
    draw.dispose();

    expect(draw.disposed).toBe(true);
    expect(frames.cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(() => draw.schedule(() => undefined, 1)).toThrow("disposed");
    expect(() => draw.flush()).toThrow("disposed");
  });
});
