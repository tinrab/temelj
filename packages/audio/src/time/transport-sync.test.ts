import { describe, expect, it, vi } from "vitest";

import { MockClockContext } from "../../tests/audio.ts";
import { Transport, createAudioSignal } from "../mod.ts";

function createMockContext(currentTime = 0): MockClockContext {
  return new MockClockContext(currentTime);
}

describe("Transport sync", () => {
  it("syncs signal values to transport BPM changes", () => {
    const context = createMockContext(0);
    const transport = new Transport({ bpm: 120, context });

    const signal = createAudioSignal(context.context, {
      autoStart: false,
      value: 2,
    });

    transport.syncSignal(signal);
    expect(signal.value).toBe(2);

    transport.setBpm(240);
    expect(signal.value).toBe(4);

    transport.unsyncSignal(signal);
    expect(signal.value).toBe(2);
  });

  it("syncs source start and duration stop to transport position", () => {
    const context = createMockContext(0);
    const transport = new Transport({ context, lookAhead: 0 });

    const source = {
      start: vi.fn<(time?: number, offset?: number, duration?: number) => void>(),
      stop: vi.fn<(time?: number) => void>(),
    };

    transport.syncSource(source, {
      duration: "4n",
      offset: "8n",
      position: "4n",
    });
    transport.start();

    transport.flush(0.5);
    expect(source.start).toHaveBeenCalledWith(0.5, 0.25, 0.5);
    expect(source.stop).not.toHaveBeenCalled();

    transport.flush(1);
    expect(source.stop).toHaveBeenCalledWith(1);
  });

  it("stops synced sources when the transport pauses or stops", () => {
    const context = createMockContext(0);
    const transport = new Transport({ context, lookAhead: 0 });

    const first = {
      start: vi.fn<(time?: number, offset?: number, duration?: number) => void>(),
      stop: vi.fn<(time?: number) => void>(),
    };

    const second = {
      start: vi.fn<(time?: number, offset?: number, duration?: number) => void>(),
      stop: vi.fn<(time?: number) => void>(),
    };

    transport.syncSource(first);
    transport.syncSource(second);
    transport.start();
    transport.flush(0);
    context.currentTime = 0.5;
    transport.pause();

    expect(first.stop).toHaveBeenCalledWith(0.5);
    expect(second.stop).toHaveBeenCalledWith(0.5);

    transport.start();
    context.currentTime = 1;
    transport.stop();

    expect(first.stop).toHaveBeenCalledWith(1);
    expect(second.stop).toHaveBeenCalledWith(1);
  });

  it("unsyncs sources and cancels their scheduled transport events", () => {
    const context = createMockContext(0);
    const transport = new Transport({ context, lookAhead: 0 });

    const source = {
      start: vi.fn<(time?: number, offset?: number, duration?: number) => void>(),
      stop: vi.fn<(time?: number) => void>(),
    };

    transport.syncSource(source, {
      duration: "4n",
      position: "2n",
    });
    expect(transport.eventCount).toBe(2);

    transport.unsyncSource(source);
    expect(transport.eventCount).toBe(0);

    transport.start();
    transport.flush(1);

    expect(source.start).not.toHaveBeenCalled();
    expect(source.stop).not.toHaveBeenCalled();
  });

  it("stops synced sources when disposed", () => {
    const context = createMockContext(0);
    const transport = new Transport({ context, lookAhead: 0 });

    const source = {
      start: vi.fn<(time?: number, offset?: number, duration?: number) => void>(),
      stop: vi.fn<(time?: number) => void>(),
    };

    transport.syncSource(source);
    context.currentTime = 2;
    transport.dispose();

    expect(source.stop).toHaveBeenCalledWith(2);
  });
});
