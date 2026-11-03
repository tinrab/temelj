import { describe, expect, it, vi } from "vitest";

import { MockClockContext } from "../../tests/audio.ts";
import { Transport, type TransportCallback } from "../mod.ts";

function createMockContext(currentTime = 0): MockClockContext {
  return new MockClockContext(currentTime);
}

describe("Transport scheduling", () => {
  it("applies swing to off-beat scheduled events", () => {
    const context = createMockContext(0);

    const transport = new Transport({
      bpm: 120,
      context,
      lookAhead: 0,
      ppq: 192,
      swing: 0.5,
      swingSubdivision: "8n",
    });

    const callback = vi.fn<TransportCallback>();

    transport.schedule(callback, "8n");
    transport.schedule(callback, "4n");
    transport.start({ position: 0 });
    transport.flush(1);

    expect(callback.mock.calls.map((call) => [call[0], call[1].position])).toEqual([
      [1 / 3, 0.25],
      [0.5, 0.5],
    ]);

    transport.setSwing(2);
    expect(transport.swing).toBe(1);
    expect(() => {
      transport.setSwing(Number.NaN);
    }).toThrow(RangeError);
    expect(() => {
      transport.setSwingSubdivision(0);
    }).toThrow(RangeError);
  });

  it("applies swing to repeating transport events", () => {
    const context = createMockContext(0);

    const transport = new Transport({
      bpm: 120,
      context,
      lookAhead: 0,
      ppq: 192,
      swing: 0.5,
      swingSubdivision: "8n",
    });

    const callback = vi.fn<TransportCallback>();

    transport.scheduleRepeat(callback, "8n", 0);
    transport.start({ position: 0 });
    transport.flush(0.5);

    expect(callback.mock.calls.map((call) => [call[0], call[1].position])).toEqual([
      [0, 0],
      [1 / 3, 0.25],
      [0.5, 0.5],
    ]);
  });

  it("returns the context time of the next subdivision", () => {
    const context = createMockContext(0);

    const transport = new Transport({
      bpm: 120,
      context,
      ppq: 192,
    });

    expect(transport.nextSubdivision("4n")).toBe(0);

    transport.start({ position: 0 });
    context.currentTime = 0.1;

    expect(transport.nextSubdivision("4n")).toBeCloseTo(0.5);

    context.currentTime = 0.5;

    expect(transport.nextSubdivision("4n")).toBeCloseTo(1);
    expect(() => transport.nextSubdivision(0)).toThrow(RangeError);
  });

  it("uses looped transport position for next subdivision", () => {
    const context = createMockContext(0);

    const transport = new Transport({
      bpm: 120,
      context,
      loop: true,
      loopEnd: 1,
      loopStart: 0,
      ppq: 192,
    });

    transport.start({ position: 0 });
    context.currentTime = 1.1;

    expect(transport.position).toBeCloseTo(0.1);
    expect(transport.nextSubdivision("4n")).toBeCloseTo(1.5);
  });

  it("reschedules active looped transport events when loop points change", () => {
    const context = createMockContext(0);

    const transport = new Transport({
      context,
      lookAhead: 0,
      loop: true,
      loopEnd: 1,
      loopStart: 0,
    });

    const callback = vi.fn<TransportCallback>();

    transport.schedule(callback, 0.75);
    transport.start({ position: 0 });
    transport.setLoopPoints(0, 0.5);
    transport.flush(2);

    expect(callback).not.toHaveBeenCalled();
  });

  it("schedules repeating events from the first position at or after start", () => {
    const context = createMockContext(5);
    const transport = new Transport({ context, lookAhead: 0 });
    const calls: number[] = [];

    transport.scheduleRepeat(
      (_time, event) => {
        calls.push(event.position);
      },
      1,
      0,
    );
    transport.start({ position: 2.5 });
    transport.flush(8);

    expect(calls).toEqual([3, 4, 5]);
  });

  it("limits repeating events to a transport duration", () => {
    const context = createMockContext(0);
    const transport = new Transport({ context, lookAhead: 0 });
    const callback = vi.fn<TransportCallback>();

    transport.scheduleRepeat(callback, 0.25, 0.5, 0.75);
    transport.start({ position: 0 });
    transport.flush(2);

    expect(callback.mock.calls.map((call) => call[1].position)).toEqual([0.5, 0.75, 1]);
    expect(() => transport.scheduleRepeat(callback, 0.25, 0, 0)).toThrow(RangeError);
  });

  it("limits looped repeating events to a transport duration", () => {
    const context = createMockContext(0);

    const transport = new Transport({
      context,
      lookAhead: 0,
      loop: true,
      loopEnd: 1,
      loopStart: 0,
    });

    const callback = vi.fn<TransportCallback>();

    transport.scheduleRepeat(callback, 0.25, 0.25, 0.5);
    transport.start({ position: 0 });
    transport.flush(2);

    expect(callback.mock.calls.map((call) => call[1].position)).toEqual([0.25, 0.5, 0.25, 0.5]);
  });

  it("cancels one-shot events after scheduleOnce callbacks", () => {
    const transport = new Transport({ context: createMockContext(), lookAhead: 0 });
    const callback = vi.fn<TransportCallback>();

    transport.scheduleOnce(callback, 1);
    transport.start();
    transport.flush(2);
    transport.flush(3);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(transport.eventCount).toBe(0);
  });

  it("supports cancellation and cancelAll", () => {
    const transport = new Transport({ context: createMockContext() });
    const first = transport.schedule(() => undefined, 1);
    transport.schedule(() => undefined, 2);

    expect(transport.cancel(first)).toBe(true);
    expect(transport.cancel(first)).toBe(false);
    expect(transport.eventCount).toBe(1);

    transport.cancelAll();

    expect(transport.eventCount).toBe(0);
  });

  it("cancels transport events at and after a position", () => {
    const context = createMockContext(0);
    const transport = new Transport({ context, lookAhead: 0 });
    const callback = vi.fn<TransportCallback>();

    transport.schedule(callback, 0.25);
    transport.schedule(callback, 0.5);
    transport.scheduleRepeat(callback, 0.25, 0.75);
    transport.cancelAfter(0.5);
    transport.start({ position: 0 });
    transport.flush(1);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(0.25, expect.objectContaining({ position: 0.25 }));
    expect(transport.eventCount).toBe(1);
    expect(() => transport.cancelAfter(-1)).toThrow(RangeError);
  });

  it("cancels already scheduled future transport events", () => {
    const context = createMockContext(0);
    const transport = new Transport({ context, lookAhead: 0 });
    const callback = vi.fn<TransportCallback>();

    transport.schedule(callback, 0.25);
    transport.schedule(callback, 0.5);
    transport.start({ position: 0 });
    transport.cancelAfter(0.5);
    transport.flush(1);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(0.25, expect.objectContaining({ position: 0.25 }));
  });

  it("reschedules active events when seeking", () => {
    const context = createMockContext(0);
    const transport = new Transport({ context, lookAhead: 0 });
    const callback = vi.fn<TransportCallback>();

    transport.schedule(callback, 5);
    transport.start({ position: 0 });
    transport.seek(4);
    transport.flush(0.9);

    expect(callback).not.toHaveBeenCalled();

    transport.flush(1);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("updates scheduler bpm and reschedules active musical events", () => {
    const context = createMockContext(0);
    const transport = new Transport({ bpm: 120, context, lookAhead: 0 });
    const callback = vi.fn<TransportCallback>();

    transport.schedule(callback, "4n");
    transport.start();
    transport.setBpm(60);
    transport.flush(0.5);

    expect(callback).not.toHaveBeenCalled();

    transport.flush(1);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("updates scheduler time signature and reschedules active musical events", () => {
    const context = createMockContext(0);

    const transport = new Transport({
      bpm: 120,
      context,
      lookAhead: 0,
      timeSignature: 4,
    });

    const callback = vi.fn<TransportCallback>();

    transport.schedule(callback, "1m");
    transport.start();
    transport.setTimeSignature([6, 8]);
    transport.flush(1.5);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(1.5, expect.objectContaining({ position: 1.5 }));
    expect(transport.toSeconds("1:2")).toBe(2.5);
  });

  it("updates scheduler PPQ and reschedules active tick events", () => {
    const context = createMockContext(0);

    const transport = new Transport({
      bpm: 120,
      context,
      lookAhead: 0,
      ppq: 192,
    });

    const callback = vi.fn<TransportCallback>();

    expect(transport.toSeconds("192i")).toBe(0.5);

    transport.schedule(callback, "192i");
    transport.start();
    transport.setPpq(384);
    transport.flush(0.25);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(0.25, expect.objectContaining({ position: 0.25 }));
    expect(transport.toSeconds("192i")).toBe(0.25);
  });
});
