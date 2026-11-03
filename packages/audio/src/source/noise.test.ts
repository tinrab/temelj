import { describe, expect, it, vi } from "vitest";

import { createMockAudioContext, asMock, MockAudioNode } from "../../tests/audio.ts";
import {
  type BufferVoice,
  Noise,
  createNoiseBuffer,
  createNoiseChannel,
  createNoiseRandom,
  getNoiseBufferInfo,
} from "../mod.ts";

function createMockContext(sampleRate = 48_000): BaseAudioContext {
  return createMockAudioContext(0, sampleRate);
}

describe("noise utilities", () => {
  it("creates seeded white noise buffers with deterministic channels", () => {
    const context = createMockContext(8);

    const first = createNoiseBuffer(context, {
      length: 4,
      numberOfChannels: 2,
      seed: 123,
      type: "white",
    });

    const second = createNoiseBuffer(context, {
      length: 4,
      numberOfChannels: 2,
      seed: 123,
      type: "white",
    });

    expect(first.length).toBe(4);
    expect(first.numberOfChannels).toBe(2);
    expect(first.sampleRate).toBe(8);
    expect(getNoiseBufferInfo(first, "white")).toEqual({
      duration: 0.5,
      length: 4,
      numberOfChannels: 2,
      sampleRate: 8,
      type: "white",
    });
    expect(Array.from(first.getChannelData(0))).toEqual(Array.from(second.getChannelData(0)));
    expect(first.getChannelData(0).some((value) => value !== 0)).toBe(true);
    expect(first.getChannelData(1).some((value) => value !== 0)).toBe(true);
  });

  it("supports duration-based pink and brown channel generation", () => {
    const context = createMockContext(10);
    const random = createNoiseRandom(1);

    const pink = createNoiseBuffer(context, {
      duration: 0.5,
      random,
      type: "pink",
    });

    const brown = createNoiseChannel("brown", 5, createNoiseRandom(1));

    expect(pink.length).toBe(5);
    expect(pink.getChannelData(0).some((value) => value !== 0)).toBe(true);
    expect(brown).toHaveLength(5);
    expect(brown.some((value) => value !== 0)).toBe(true);
  });

  it("rejects invalid buffer options", () => {
    const context = createMockContext();

    expect(() => createNoiseBuffer(context, { length: 0 })).toThrow("Noise length");
    expect(() => createNoiseBuffer(context, { numberOfChannels: 0 })).toThrow(
      "Noise channel count",
    );
    expect(() => createNoiseBuffer(context, { sampleRate: 0 })).toThrow("sampleRate");
  });

  it("loops a noise buffer with fades through a per-start voice", () => {
    const context = createMockAudioContext(0, 8);
    const onStop = vi.fn<(voice: BufferVoice) => void>();

    const noise = new Noise(context, {
      fadeIn: 0.25,
      fadeOut: 0.5,
      length: 8,
      onStop,
      playbackRate: 2,
      seed: 1,
      type: "pink",
      volume: 0.75,
    });

    expect(noise.type).toBe("pink");
    expect(noise.state).toBe("stopped");
    expect(noise.output.gain.value).toBe(0.75);

    noise.start({ offset: 0.1, time: 3 });
    const source = context.createdSources[0]!;
    const voiceGain = context.createdGains[1]!;

    expect(noise.state).toBe("started");
    expect(source.loop).toBe(true);
    expect(source.playbackRate.value).toBe(2);
    expect(source.start).toHaveBeenCalledWith(3, 0.1);
    expect(voiceGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 3.25);

    noise.setPlaybackRate(0.5, 4);
    expect(source.playbackRate.setValueAtTime).toHaveBeenCalledWith(0.5, 4);

    noise.stop(5);
    expect(noise.state).toBe("stopped");
    expect(source.stop).toHaveBeenCalledWith(5.5);
    expect(voiceGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 5.5);
    expect(onStop).toHaveBeenCalledTimes(1);

    source.onended?.();
    expect(source.disconnect).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("restarts with a new colour and disposes once", () => {
    const context = createMockAudioContext(0, 8);
    const noise = new Noise(context, { length: 8, mute: true, volume: 0.75 });

    expect(noise.output.gain.value).toBe(0);
    noise.start({ offset: 0, time: 4 });
    noise.setType("brown");
    expect(noise.type).toBe("brown");
    expect(context.createdSources).toHaveLength(2);

    noise.dispose();
    noise.dispose();
    expect(asMock<MockAudioNode>(noise.output).disconnect).toHaveBeenCalledTimes(1);
    expect(() => new Noise(context, { playbackRate: 0 })).toThrow(RangeError);
  });
});
