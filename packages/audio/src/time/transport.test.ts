import { describe, expect, it, vi } from "vitest";

import { MockClockContext } from "../../tests/audio.ts";
import { AudioDisposedError, Transport, type TransportCallback } from "../mod.ts";

function createMockContext(currentTime = 0): MockClockContext {
  return new MockClockContext(currentTime);
}

describe("Transport", () => {
  it("schedules events relative to the transport start position", () => {
    const context = createMockContext(10);
    const transport = new Transport({ context, lookAhead: 0 });
    const callback = vi.fn<TransportCallback>();

    transport.schedule(callback, 2);
    transport.start({ position: 1 });

    transport.flush(10.5);
    expect(callback).not.toHaveBeenCalled();

    transport.flush(11);
    expect(callback).toHaveBeenCalledWith(11, expect.objectContaining({ position: 2 }));
  });

  it("tracks position across pause and resume", () => {
    const context = createMockContext(0);
    const transport = new Transport({ context });

    transport.start({ position: 1 });
    context.currentTime = 2.5;

    expect(transport.position).toBe(3.5);

    transport.pause();
    context.currentTime = 10;

    expect(transport.state).toBe("paused");
    expect(transport.position).toBe(3.5);

    transport.start();
    context.currentTime = 11;

    expect(transport.position).toBe(4.5);
  });

  it("toggles transport playback state", () => {
    const context = createMockContext(0);
    const transport = new Transport({ context });

    transport.toggle({ position: 1 });

    expect(transport.state).toBe("started");
    expect(transport.position).toBe(1);

    context.currentTime = 0.5;
    transport.toggle();

    expect(transport.state).toBe("stopped");
    expect(transport.position).toBe(0);

    transport.toggle({ position: "4n" });

    expect(transport.state).toBe("started");
    expect(transport.position).toBe(0.5);
  });

  it("schedules transport start, pause, stop, and toggle controls", () => {
    const context = createMockContext(0);
    const transport = new Transport({ context, lookAhead: 0 });
    const start = vi.fn<(event: { readonly position: number }) => void>();
    const pause = vi.fn<(event: { readonly position: number }) => void>();
    const stop = vi.fn<(event: { readonly position: number }) => void>();

    transport.events.on("start", start);
    transport.events.on("pause", pause);
    transport.events.on("stop", stop);
    transport.start({ position: 1, time: 0.5 });
    transport.pause({ time: 1 });
    transport.toggle({ position: 2, time: 1.5 });
    transport.stop({ position: 0.25, time: 2 });

    transport.flush(0.25);

    expect(transport.state).toBe("stopped");

    transport.flush(0.5);

    expect(transport.state).toBe("started");
    expect(transport.position).toBe(1);
    expect(start).toHaveBeenCalledWith({ position: 1 }, "start");

    context.currentTime = 1;
    transport.flush(1);

    expect(transport.state).toBe("paused");
    expect(pause).toHaveBeenCalledWith({ position: 1.5 }, "pause");

    transport.flush(1.5);

    expect(transport.state).toBe("started");
    expect(transport.position).toBe(2);

    transport.flush(2);

    expect(transport.state).toBe("stopped");
    expect(transport.position).toBe(0.25);
    expect(stop).toHaveBeenCalledWith({ position: 0.25 }, "stop");
  });

  it("reads and seeks transport position in ticks", () => {
    const context = createMockContext(0);
    const transport = new Transport({ bpm: 120, context, ppq: 192 });

    transport.seek("4n");

    expect(transport.position).toBe(0.5);
    expect(transport.ticks).toBe(192);
    expect(transport.toTicks("4n")).toBe(192);
    expect(transport.toBarsBeatsSixteenths("4n")).toBe("0:1:0");

    transport.seek(`${384}i`);

    expect(transport.position).toBe(1);

    transport.setPpq(384);

    expect(transport.ticks).toBe(768);
  });

  it("reads and schedules transport seconds and ticks at context times", () => {
    const context = createMockContext(0);
    const transport = new Transport({ bpm: 120, context, lookAhead: 0, ppq: 192 });

    transport.seek(0.5);

    expect(transport.position).toBe(0.5);
    expect(transport.seconds).toBe(0.5);

    transport.start({ position: 0.5 });
    context.currentTime = 0.25;

    expect(transport.getSecondsAtTime(0.75)).toBe(1.25);
    expect(transport.getTicksAtTime(0.75)).toBe(480);

    transport.seek(2, { time: 0.5 });
    transport.flush(0.5);

    expect(transport.position).toBe(2);

    transport.seek(`${192}i`, { time: 0.75 });
    transport.flush(0.75);

    expect(transport.position).toBe(0.5);
    expect(() => transport.seek(-1, { time: 1 })).toThrow(RangeError);
  });

  it("anchors scheduled seeks to the scheduled context time", () => {
    const context = createMockContext(0);
    const transport = new Transport({ bpm: 120, context, lookAhead: 0, ppq: 192 });

    transport.start({ position: 0 });
    transport.seek("4n", { time: 1 });
    transport.flush(1);

    expect(transport.position).toBe(0.5);

    context.currentTime = 1.25;

    expect(transport.position).toBe(0.75);

    transport.seek(2, { time: 2 });
    transport.seek(`${192}i`, { time: 3 });
    transport.flush(2);

    context.currentTime = 2.25;

    expect(transport.position).toBe(2.25);

    transport.flush(3);

    context.currentTime = 3.25;

    expect(transport.position).toBe(0.75);
  });

  it("converts transport ticks back to context times", () => {
    const context = createMockContext(0);
    const transport = new Transport({ bpm: 120, context, ppq: 192 });

    transport.start({ position: 0 });
    context.currentTime = 0.25;

    expect(transport.getTimeOfTick(192, 0.25)).toBe(0.5);
    expect(transport.nextTickTime(96, 0.25)).toBe(0.5);
    expect(() => transport.getTimeOfTick(-1)).toThrow(RangeError);
    expect(() => transport.nextTickTime(-1)).toThrow(RangeError);
  });

  it("uses looped transport ticks for tick time lookups", () => {
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
    context.currentTime = 1.25;

    expect(transport.getTicksAtTime(1.25)).toBe(96);
    expect(transport.getTimeOfTick(192, 1.25)).toBe(1.5);
    expect(transport.nextTickTime(96, 1.25)).toBe(1.5);
  });

  it("emits transport lifecycle and tick changes", () => {
    const context = createMockContext(0);
    const transport = new Transport({ bpm: 120, context, lookAhead: 0, ppq: 192 });
    const start = vi.fn<(event: { readonly position: number }) => void>();
    const pause = vi.fn<(event: { readonly position: number }) => void>();
    const stop = vi.fn<(event: { readonly position: number }) => void>();
    const onceStart = vi.fn<(event: { readonly position: number }) => void>();

    transport.events.on("start", start);
    transport.events.once("start", onceStart);
    transport.events.on("pause", pause);
    transport.events.on("stop", stop);

    expect(transport.events.listenerCount("start")).toBe(2);

    transport.start({ position: "4n" });
    context.currentTime = 0.25;
    transport.pause();
    transport.start();
    transport.seek(`${384}i`);
    transport.seek(`${192}i`, { time: 0.5 });
    transport.flush(0.5);
    transport.seek(`${768}i`);
    transport.stop({ position: "8n" });

    expect(start).toHaveBeenNthCalledWith(1, { position: 0.5 }, "start");
    expect(start).toHaveBeenNthCalledWith(2, { position: 0.75 }, "start");
    expect(onceStart).toHaveBeenCalledOnce();
    expect(pause).toHaveBeenCalledWith({ position: 0.75 }, "pause");
    expect(stop).toHaveBeenCalledWith({ position: 0.25 }, "stop");
  });

  it("emits transport loop boundary events", () => {
    const context = createMockContext(0);

    const transport = new Transport({
      context,
      lookAhead: 0,
      loop: true,
      loopEnd: 1,
      loopStart: 0.25,
    });

    const loop = vi.fn<(event: { readonly time: number }) => void>();
    const loopEnd = vi.fn<(event: { readonly time: number }) => void>();

    const loopStart =
      vi.fn<(event: { readonly position: number; readonly time: number }) => void>();

    transport.events.on("loop", loop);
    transport.events.on("loopEnd", loopEnd);
    transport.events.on("loopStart", loopStart);
    transport.start({ position: 0.25 });
    // Starting again while started must not schedule the loop boundary twice.
    transport.start({ position: 0.25 });

    transport.flush(1);

    expect(loop).toHaveBeenCalledTimes(1);

    expect(loopEnd).toHaveBeenCalledWith({ time: 0.75 }, "loopEnd");
    expect(loopStart).toHaveBeenCalledWith({ position: 0.25, time: 0.75 }, "loopStart");
    expect(loop).toHaveBeenCalledWith({ time: 0.75 }, "loop");

    context.currentTime = 0.75;
    transport.setLoopPoints(0.5, 1);
    transport.flush(1.25);

    expect(loopStart).toHaveBeenLastCalledWith({ position: 0.5, time: 1.25 }, "loopStart");
    expect(loop).toHaveBeenCalledTimes(2);

    transport.pause();
    transport.flush(2);

    expect(loop).toHaveBeenCalledTimes(2);
  });

  it("reads and seeks transport position as bars:beats:sixteenths", () => {
    const context = createMockContext(0);
    const transport = new Transport({ bpm: 120, context, ppq: 192 });

    transport.seek("1:2");

    expect(transport.position).toBe(3);
    expect(transport.barsBeatsSixteenths).toBe("1:2:0");

    transport.seek("0:3:2");

    expect(transport.position).toBe(1.75);
    expect(transport.ticks).toBe(672);

    transport.setTimeSignature([6, 8]);

    expect(transport.barsBeatsSixteenths).toBe("1:0:2");
  });

  it("tracks running transport ticks", () => {
    const context = createMockContext(0);
    const transport = new Transport({ bpm: 120, context, ppq: 192 });

    transport.start({ position: "4n" });
    context.currentTime = 0.25;

    expect(transport.position).toBe(0.75);
    expect(transport.ticks).toBe(288);

    transport.seek(`${96}i`);

    expect(transport.position).toBe(0.25);
  });

  it("tracks running transport bars:beats:sixteenths position", () => {
    const context = createMockContext(0);
    const transport = new Transport({ bpm: 120, context, ppq: 192 });

    transport.start({ position: "0:2:0" });
    context.currentTime = 0.25;

    expect(transport.position).toBe(1.25);
    expect(transport.barsBeatsSixteenths).toBe("0:2:2");

    transport.seek("0:1:0");

    expect(transport.position).toBe(0.5);
    expect(() => {
      transport.seek("bad");
    }).toThrow(RangeError);
  });

  it("loops transport position between loop points", () => {
    const context = createMockContext(0);

    const transport = new Transport({
      context,
      loop: true,
      loopEnd: 1,
      loopStart: 0.25,
    });

    expect(transport.loop).toBe(true);
    expect(transport.loopStart).toBe(0.25);
    expect(transport.loopEnd).toBe(1);
    expect(transport.progress).toBe(0);

    transport.start({ position: 0 });
    context.currentTime = 0.5;
    expect(transport.position).toBe(0.5);
    expect(transport.progress).toBeCloseTo(1 / 3);

    context.currentTime = 1;
    expect(transport.position).toBe(0.25);
    expect(transport.progress).toBe(0);

    context.currentTime = 1.5;
    expect(transport.position).toBe(0.75);
    expect(transport.progress).toBeCloseTo(2 / 3);
  });

  it("updates transport loop points together", () => {
    const transport = new Transport({
      context: createMockContext(),
      loop: true,
      loopEnd: "1m",
      loopStart: 0,
    });

    transport.setLoopPoints("4n", "2n");

    expect(transport.loopStart).toBe("4n");
    expect(transport.loopEnd).toBe("2n");
    expect(transport.progress).toBe(0);

    transport.seek("4n");

    expect(transport.progress).toBe(0);
  });

  it("loops one-shot events scheduled inside the transport loop", () => {
    const context = createMockContext(0);

    const transport = new Transport({
      context,
      lookAhead: 0,
      loop: true,
      loopEnd: 1,
      loopStart: 0,
    });

    const callback = vi.fn<TransportCallback>();

    transport.schedule(callback, 0.25);
    transport.schedule(() => undefined, 1.25);
    transport.start({ position: 0 });
    transport.flush(2.25);

    expect(callback.mock.calls.map((call) => call[0])).toEqual([0.25, 1.25, 2.25]);
    expect(callback.mock.calls.map((call) => call[1].position)).toEqual([0.25, 0.25, 0.25]);
  });

  it("treats the loop end as exclusive for looped one-shot events", () => {
    const context = createMockContext(0);

    const transport = new Transport({
      context,
      lookAhead: 0,
      loop: true,
      loopEnd: 1,
      loopStart: 0,
    });

    const loopStart = vi.fn<TransportCallback>();
    const loopEnd = vi.fn<TransportCallback>();

    transport.schedule(loopStart, 0);
    transport.schedule(loopEnd, 1);
    transport.start({ position: 0 });
    transport.flush(2);

    expect(loopStart.mock.calls.map((call) => call[0])).toEqual([0, 1, 2]);
    expect(loopStart.mock.calls.map((call) => call[1].position)).toEqual([0, 0, 0]);
    expect(loopEnd).not.toHaveBeenCalled();
  });

  it("rejects invalid positions and disposes safely", () => {
    const transport = new Transport({ context: createMockContext() });

    expect(transport.disposed).toBe(false);
    expect(() => transport.start({ position: -1 })).toThrow(RangeError);
    expect(() => transport.seek(-1)).toThrow(RangeError);

    transport.schedule(() => undefined, 1);
    transport.dispose();
    transport.dispose();

    expect(transport.disposed).toBe(true);
    expect(transport.state).toBe("stopped");
    expect(() => transport.scheduler.schedule(() => undefined, 1)).toThrow(AudioDisposedError);
  });
});
