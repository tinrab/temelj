import { describe, expect, it, vi } from "vitest";

import { asNative } from "../../tests/audio.ts";
import {
  Transport,
  Loop,
  Part,
  Pattern,
  Sequence,
  createPatternIndexGenerator,
  type AudioEventCallbackContext,
} from "../mod.ts";

type ValueCallback = (time: number, value: string, context: AudioEventCallbackContext) => void;

function createTransport(): Transport {
  return new Transport({
    bpm: 120,
    clearTimeout: () => undefined,
    context: asNative<BaseAudioContext>({
      currentTime: 0,
      destination: {},
      sampleRate: 48_000,
      state: "running",
    }),
    setTimeout: () => 0,
  });
}

function run(transport: Transport, until: number): void {
  transport.start({ position: 0 });
  transport.flush(until);
}

describe("Loop", () => {
  it("repeats with finite iterations, playback rate, and musical context", () => {
    const transport = createTransport();
    const callback = vi.fn<(time: number, context: AudioEventCallbackContext) => void>();
    const loop = new Loop(transport, callback, { interval: "4n", iterations: 3, playbackRate: 2 });

    loop.start(0);
    expect(loop.state).toBe("started");
    run(transport, 1);

    expect(callback.mock.calls.map(([time]) => time)).toEqual([0, 0.25, 0.5]);
    expect(callback.mock.calls.map(([, context]) => context.ticks)).toEqual([0, 96, 192]);
    expect(callback.mock.calls.map(([, context]) => context.barsBeatsSixteenths)).toEqual([
      "0:0:0",
      "0:0:2",
      "0:1:0",
    ]);
    expect(loop.state).toBe("stopped");
  });

  it("reschedules when the interval or rate changes, and disposes once", () => {
    const transport = createTransport();
    const callback = vi.fn<(time: number) => void>();
    const loop = new Loop(transport, callback, { iterations: 2 });

    loop.start(0);
    loop.setInterval("8n");
    loop.setPlaybackRate(2);
    expect(transport.eventCount).toBe(1);
    run(transport, 0.25);
    expect(callback.mock.calls.map(([time]) => time)).toEqual([0, 0.125]);

    loop.dispose();
    loop.dispose();
    expect(loop.disposed).toBe(true);
    expect(transport.eventCount).toBe(0);
    expect(() => {
      loop.setPlaybackRate(0);
    }).toThrow(RangeError);
  });

  it("applies mute, probability, and humanize", () => {
    const transport = createTransport();
    const callback = vi.fn<(time: number) => void>();
    const random = vi.fn<() => number>(() => 1);

    const loop = new Loop(transport, callback, {
      humanize: 0.1,
      interval: "4n",
      iterations: 3,
      random,
    });

    loop.setMute(true);
    loop.start(0);
    run(transport, 0.1);
    expect(callback).not.toHaveBeenCalled();

    loop.setMute(false);
    loop.setProbability(0.5);
    transport.flush(0.6);
    expect(callback).not.toHaveBeenCalled();

    loop.setProbability(1);
    transport.flush(1.1);
    expect(callback.mock.calls[0]?.[0]).toBeCloseTo(1.1, 12);
  });
});

describe("Part", () => {
  it("plays timed values after the start offset", () => {
    const transport = createTransport();
    const callback = vi.fn<ValueCallback>();

    const part = new Part(transport, callback, [
      { time: "4n", value: "snare" },
      { time: 0, value: "kick" },
    ]);

    part.start("8n");
    run(transport, 1);

    expect(
      callback.mock.calls.map(([time, value, context]) => [time, value, context.index]),
    ).toEqual([
      [0.25, "kick", 0],
      [0.75, "snare", 1],
    ]);
  });

  it("adds, replaces, and removes events while running", () => {
    const transport = createTransport();
    const callback = vi.fn<ValueCallback>();
    const part = new Part(transport, callback, [{ time: 0, value: "a" }]);

    part.start();
    part.add("4n", "b");
    expect(transport.eventCount).toBe(2);
    expect(part.at("4n")).toEqual({ time: "4n", value: "b" });

    part.set("4n", "c").set("2n", "d").remove(0, "a");
    expect(part.events.map((event) => event.value)).toEqual(["c", "d"]);
    expect(transport.eventCount).toBe(2);

    run(transport, 1);
    expect(callback.mock.calls.map(([, value]) => value)).toEqual(["c", "d"]);

    part.clear();
    expect(part.length).toBe(0);
    expect(part.state).toBe("stopped");
  });

  it("loops events inside the loop region", () => {
    const transport = createTransport();
    const callback = vi.fn<ValueCallback>();

    const part = new Part(
      transport,
      callback,
      [
        { time: 0, value: "a" },
        { time: "4n", value: "b" },
        { time: "2n", value: "outside" },
      ],
      { loop: true, loopEnd: "2n", loopStart: 0 },
    );

    part.start(0);
    run(transport, 1.1);
    expect(callback.mock.calls.map(([time, value]) => [time, value])).toEqual([
      [0, "a"],
      [0.5, "b"],
      [1, "a"],
    ]);

    part.stop();
    part.setLoopPoints("2n", 0);
    expect(() => part.start()).toThrow(RangeError);
  });
});

describe("Sequence", () => {
  it("spaces values by interval and rebuilds when they change", () => {
    const transport = createTransport();
    const callback = vi.fn<ValueCallback>();
    const sequence = new Sequence(transport, callback, ["a", "b", "c"], { interval: "8n" });

    expect(sequence.events.map((event) => event.time)).toEqual([0, 0.25, 0.5]);

    sequence.setInterval("4n");
    expect(sequence.events.map((event) => event.time)).toEqual([0, 0.5, 1]);

    sequence.start(0);
    sequence.setValues(["x", "y"]);
    expect(transport.eventCount).toBe(2);
    run(transport, 1);
    expect(callback.mock.calls.map(([, value]) => value)).toEqual(["x", "y"]);
  });

  it("loops a range of steps", () => {
    const transport = createTransport();
    const callback = vi.fn<ValueCallback>();

    const sequence = new Sequence(transport, callback, ["a", "b", "c", "d"], {
      interval: "8n",
      loop: true,
      loopEnd: 3,
      loopStart: 1,
    });

    sequence.start(0);
    run(transport, 1);
    expect(callback.mock.calls.map(([time, value]) => [time, value])).toEqual([
      [0, "b"],
      [0.25, "c"],
      [0.5, "b"],
      [0.75, "c"],
      [1, "b"],
    ]);
    expect(() => {
      sequence.setLoopSteps(-1, 2);
    }).toThrow(RangeError);
  });
});

describe("Pattern", () => {
  it("walks values in the selected order for the given iterations", () => {
    const transport = createTransport();
    const callback = vi.fn<ValueCallback>();

    const pattern = new Pattern(transport, callback, ["a", "b", "c"], {
      interval: "8n",
      iterations: 5,
      pattern: "upDown",
    });

    pattern.start(0);
    run(transport, 2);

    expect(callback.mock.calls.map(([time, value]) => [time, value])).toEqual([
      [0, "a"],
      [0.25, "b"],
      [0.5, "c"],
      [0.75, "b"],
      [1, "a"],
    ]);
    expect(pattern.value).toBe("a");
    expect(pattern.state).toBe("stopped");
  });

  it("replaces values and order, and validates options", () => {
    const transport = createTransport();
    const callback = vi.fn<ValueCallback>();
    const pattern = new Pattern(transport, callback, ["a", "b", "c"], { iterations: 3 });

    pattern.setValues(["x", "y"]);
    pattern.setPattern("down");
    pattern.start();
    run(transport, 1);
    expect(callback.mock.calls.map(([, value]) => value)).toEqual(["y", "x", "y"]);

    expect(() => new Pattern(transport, callback, [])).toThrow(RangeError);
    expect(() => new Pattern(transport, callback, ["a"], { iterations: -1 })).toThrow(RangeError);
  });

  it("generates deterministic random orders from the random source", () => {
    const random = vi.fn<() => number>(() => 0.5);
    const indexes = createPatternIndexGenerator(4, "randomOnce", random);

    expect([0, 1, 2, 3].map(() => indexes.next().value)).toEqual([2, 1, 3, 0]);
  });
});
