import { describe, expect, it, vi } from "vitest";

import {
  createMockAudioBuffer as createMockBuffer,
  createMockAudioContext as createMockContext,
} from "../../tests/audio.ts";
import { GrainPlayer, type BufferVoice } from "../mod.ts";

describe("GrainPlayer", () => {
  it("schedules overlapping grains with cross-fades", () => {
    const context = createMockContext(2);

    const player = new GrainPlayer(context, createMockBuffer(1), {
      detune: 1200,
      grainSize: 0.2,
      overlap: 0.05,
      playbackRate: 2,
      volume: 0.5,
    });

    expect(player.output.gain.value).toBe(0.5);
    expect(player.state).toBe("stopped");

    const grains = player.start({ duration: 0.35, offset: 0.1, time: 3 });

    // 0.35 s of buffer at 0.2 s per grain.
    expect(grains).toHaveLength(2);
    expect(player.state).toBe("started");
    expect(context.createdSources.map((source) => source.start.mock.calls[0])).toEqual([
      [3, 0.1],
      [3.1, 0.30000000000000004],
    ]);
    expect(context.createdSources[0]?.playbackRate.value).toBe(4);
    // Each grain runs one fade past the next grain's start (3.1), so the fades overlap.
    expect(context.createdSources[0]?.stop.mock.calls[0]?.[0]).toBeCloseTo(3.15, 9);

    const grainGain = context.createdGains[1]!;
    expect(grainGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 3.05);
    const fadeOut = grainGain.gain.linearRampToValueAtTime.mock.calls.at(-1);
    expect(fadeOut?.[0]).toBe(0);
    expect(fadeOut?.[1]).toBeCloseTo(3.15, 9);
    expect(grainGain.gain.setValueAtTime).toHaveBeenCalledWith(1, 3.1);
  });

  it("keeps scheduling looped grains until stopped", () => {
    vi.useFakeTimers();

    try {
      const context = createMockContext(2);

      const player = new GrainPlayer(context, createMockBuffer(1), {
        grainSize: 0.1,
        loop: true,
        overlap: 0.02,
      });

      // Grains are scheduled 0.25 s ahead of the clock: at 2, 2.1, and 2.2.
      expect(player.start({ time: 2 })).toHaveLength(3);
      expect(player.state).toBe("started");

      context.currentTime = 2.3;
      vi.advanceTimersByTime(100);
      expect(context.createdSources).toHaveLength(6);

      player.stop();
      context.currentTime = 3;
      vi.advanceTimersByTime(500);

      expect(context.createdSources).toHaveLength(6);
      expect(player.state).toBe("stopped");
    } finally {
      vi.useRealTimers();
    }
  });

  it("wraps grain offsets inside loop points", () => {
    const context = createMockContext(2);

    const player = new GrainPlayer(context, createMockBuffer(2), {
      grainSize: 0.25,
      loop: true,
      loopEnd: 1,
      loopStart: 0.5,
    });

    player.start({ duration: 1, offset: 0.75, time: 0 });

    expect(context.createdSources.map((source) => source.start.mock.calls[0]?.[1])).toEqual([
      0.75, 0.5, 0.75, 0.5,
    ]);
  });

  it("stops and disposes grains, notifying once per grain", () => {
    const context = createMockContext(2);
    const onStop = vi.fn<(grain: BufferVoice) => void>();
    const player = new GrainPlayer(context, createMockBuffer(1), { grainSize: 0.5, onStop });

    player.start({ duration: 1, time: 3 });
    player.stop(3.25);
    expect(player.state).toBe("stopped");
    expect(onStop).toHaveBeenCalledTimes(2);

    player.start({ time: 4 });
    player.dispose();
    player.dispose();
    expect(player.activeGrains).toHaveLength(0);
    expect(onStop).toHaveBeenCalledTimes(4);
    expect(() => {
      player.setPlaybackRate(0);
    }).toThrow(RangeError);
  });
});
