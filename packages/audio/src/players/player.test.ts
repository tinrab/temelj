import { describe, expect, it, vi } from "vitest";

import {
  createMockAudioBuffer as createMockBuffer,
  createMockAudioContext as createMockContext,
  type MockBufferSourceNode,
  type MockGainNode,
  asMock,
  invalid,
} from "../../tests/audio.ts";
import { Player, type BufferVoice } from "../mod.ts";

type StopCallback = (voice: BufferVoice) => void;

describe("audio player utilities", () => {
  it("starts a buffer with fades, playback rate, and explicit duration", () => {
    const context = createMockContext(2);
    const buffer = createMockBuffer(2);

    const player = new Player(context, buffer, {
      fadeIn: 0.1,
      fadeOut: 0.2,
      playbackRate: 2,
      volume: 0.75,
    });

    const output = asMock<MockGainNode>(player.output);

    expect(player.state).toBe("stopped");
    expect(player.disposed).toBe(false);
    expect(output.gain.value).toBe(0.75);

    const voice = player.start({ time: 3, offset: 0.5, duration: 1 });
    const source = asMock<MockBufferSourceNode>(voice.source);
    const gain = context.createdGains[1]!;

    expect(player.state).toBe("started");
    expect(source.buffer).toBe(buffer);
    expect(voice.disposed).toBe(false);
    expect(source.playbackRate.value).toBe(2);
    expect(source.start).toHaveBeenCalledWith(3, 0.5);
    expect(source.stop).toHaveBeenCalledWith(3.5);
    expect(source.connect).toHaveBeenCalledWith(gain);
    expect(gain.connect).toHaveBeenCalledWith(output);
    expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(0, 3);
    expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 3.1);
    expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 3.5);
    expect(player.activeVoices).toHaveLength(1);

    source.onended?.();
    voice.dispose();
    expect(voice.disposed).toBe(true);
    expect(player.activeVoices).toHaveLength(0);
    expect(player.state).toBe("stopped");
  });

  it("autostarts playback and exposes source state", () => {
    const context = createMockContext(2);

    const player = new Player(context, createMockBuffer(2), {
      autostart: true,
    });

    const voice = player.activeVoices[0]!;
    const source = asMock<MockBufferSourceNode>(voice.source);

    expect(context.createdSources).toHaveLength(1);
    expect(player.state).toBe("started");
    expect(source.start).toHaveBeenCalledWith(2, 0);
    expect(source.stop).toHaveBeenCalledWith(4);

    source.onended?.();

    expect(player.state).toBe("stopped");
  });

  it("supports ToneBufferSource-style per-start gain", () => {
    const context = createMockContext(2);

    const player = new Player(context, createMockBuffer(2), {
      fadeIn: 0.1,
      fadeOut: 0.2,
    });

    const voice = player.start({ time: 3, offset: 0, duration: 1, gain: 0.4 });
    const source = asMock<MockBufferSourceNode>(voice.source);
    const gain = context.createdGains[1]!;

    expect(source.start).toHaveBeenCalledWith(3, 0);
    expect(source.stop).toHaveBeenCalledWith(4);
    expect(gain.gain.value).toBe(0);
    expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.4, 3.1);
    expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 4);

    expect(() => player.start({ time: 4, offset: 0, duration: 0.1, gain: -1 })).toThrow("gain");
  });

  it("tracks mutable mute and volume state on the output", () => {
    const context = createMockContext(2);

    const player = new Player(context, createMockBuffer(2), {
      mute: true,
      volume: 0.75,
    });

    const output = asMock<MockGainNode>(player.output);

    expect(player.mute).toBe(true);
    expect(output.gain.value).toBe(0);

    player.setMute(false, 3);
    expect(player.mute).toBe(false);
    expect(output.gain.setValueAtTime).toHaveBeenCalledWith(0.75, 3);

    player.setVolume(0.5, 4);
    expect(output.gain.setValueAtTime).toHaveBeenCalledWith(0.5, 4);

    player.setMute(true, 5);
    expect(player.mute).toBe(true);
    expect(output.gain.setValueAtTime).toHaveBeenCalledWith(0, 5);

    player.setVolume(0.25, 6);
    expect(output.gain.setValueAtTime).toHaveBeenCalledWith(0, 6);

    player.setMute(false, 7);
    expect(output.gain.setValueAtTime).toHaveBeenCalledWith(0.25, 7);

    expect(() => player.setVolume(-1)).toThrow("volume");
  });

  it("starts looping sources from loop start until stopped", () => {
    const context = createMockContext(2);
    const onstop = vi.fn<StopCallback>();

    const player = new Player(context, createMockBuffer(3), {
      loop: true,
      loopEnd: 1.25,
      loopStart: 0.25,
      onStop: onstop,
    });

    const voice = player.start({ time: 3 });
    const source = asMock<MockBufferSourceNode>(voice.source);

    expect(source.loop).toBe(true);
    expect(source.loopStart).toBe(0.25);
    expect(source.loopEnd).toBe(1.25);
    expect(source.start).toHaveBeenCalledWith(3, 0.25);

    player.stop(4);
    expect(source.stop).toHaveBeenCalledWith(4);
    expect(player.activeVoices).toHaveLength(0);
    expect(onstop).toHaveBeenCalledExactlyOnceWith(voice);

    source.onended?.();
    voice.stop(5);
    expect(onstop).toHaveBeenCalledTimes(1);
  });

  it("updates active source settings and restarts playback", () => {
    const context = createMockContext(2);

    const player = new Player(context, createMockBuffer(2), {
      fadeOut: 0.1,
    });

    const first = player.start({ time: 3 });
    const firstSource = asMock<MockBufferSourceNode>(first.source);

    player.setLoop(true);
    player.setLoopPoints(0.2, 1.2);
    player.setPlaybackRate(0.5, 3.5);

    expect(firstSource.loop).toBe(true);
    expect(firstSource.loopStart).toBe(0.2);
    expect(firstSource.loopEnd).toBe(1.2);
    expect(firstSource.playbackRate.setValueAtTime).toHaveBeenCalledWith(0.5, 3.5);

    const second = player.restart({ time: 4, offset: 0.4, duration: 0.5 });
    expect(firstSource.stop).toHaveBeenCalledWith(4.1);
    expect(player.activeVoices).toHaveLength(1);
    expect(second.source).not.toBe(first.source);
  });

  it("seeks active playback and ignores stopped playback", () => {
    const context = createMockContext(2);

    const player = new Player(context, createMockBuffer(2), {
      fadeOut: 0.1,
    });

    expect(player.seek(0.25, 3)).toBeUndefined();

    const first = player.start({ time: 3 });
    const firstSource = asMock<MockBufferSourceNode>(first.source);
    const next = player.seek(0.75, 4);
    const nextSource = asMock<MockBufferSourceNode>(next?.source);

    expect(firstSource.stop).toHaveBeenCalledWith(4.1);
    expect(next).toBeDefined();
    expect(nextSource.start).toHaveBeenCalledWith(4, 0.75);
    expect(nextSource.stop).toHaveBeenCalledWith(5.25);
    expect(player.activeVoices).toHaveLength(1);
  });

  it("reports active playback progress", () => {
    const context = createMockContext(2);

    const player = new Player(context, createMockBuffer(2), {
      playbackRate: 2,
    });

    expect(player.progress).toBe(0);

    player.start({ time: 3, offset: 0.25 });
    context.currentTime = 3.5;
    expect(player.progress).toBe(1.25);

    context.currentTime = 4.5;
    expect(player.progress).toBe(0);
  });

  it("wraps looping playback progress between loop points", () => {
    const context = createMockContext(2);

    const player = new Player(context, createMockBuffer(3), {
      loop: true,
      loopStart: 0.5,
      loopEnd: 1.5,
    });

    player.start({ time: 3 });
    context.currentTime = 3.25;
    expect(player.progress).toBe(0.75);

    context.currentTime = 4.25;
    expect(player.progress).toBe(0.75);
  });

  it("supports reverse buffers and option validation", () => {
    const context = createMockContext(2);
    const buffer = createMockBuffer(2);
    const player = new Player(context, buffer);

    expect(player.duration).toBe(2);

    player.setReverse(true);
    expect(player.reverse).toBe(true);
    expect(player.buffer).not.toBe(buffer);
    expect(player.duration).toBe(2);

    player.setReverse(false);
    expect(player.buffer).toBe(buffer);
    expect(player.duration).toBe(2);

    expect(() => player.setPlaybackRate(0)).toThrow("playbackRate");
    expect(() => player.setFadeIn(-1)).toThrow("fadeIn");
    expect(() => player.setFadeOut(-1)).toThrow("fadeOut");
  });

  it("supports Tone-style exponential fade curves", () => {
    const context = createMockContext(2);

    const player = new Player(context, createMockBuffer(2), {
      fadeCurve: "exponential",
      fadeIn: 0.3,
      fadeOut: 0.6,
    });

    expect(player.fadeCurve).toBe("exponential");

    const voice = player.start({ time: 3, offset: 0, duration: 1 });
    const gain = context.createdGains[1]!;

    expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(0, 3);
    expect(gain.gain.setTargetAtTime.mock.calls[0]).toEqual([1, 3, expect.closeTo(0.1, 12)]);
    expect(gain.gain.setTargetAtTime.mock.calls[1]).toEqual([0, 3.4, expect.closeTo(0.2, 12)]);

    player.setFadeCurve("linear");
    expect(player.fadeCurve).toBe("linear");

    voice.stop(4);
    expect(gain.gain.setTargetAtTime.mock.calls[2]).toEqual([0, 4, expect.closeTo(0.2, 12)]);

    expect(() => {
      player.setFadeCurve(invalid<"linear">("invalid"));
    }).toThrow("fadeCurve");
  });

  it("disposes active voices and output idempotently", () => {
    const context = createMockContext(2);
    const onstop = vi.fn<StopCallback>();
    const player = new Player(context, createMockBuffer(2), { onStop: onstop });
    const output = asMock<MockGainNode>(player.output);

    const voice = player.start({ time: 3 });
    const source = asMock<MockBufferSourceNode>(voice.source);
    const gain = context.createdGains[1]!;

    player.dispose();
    player.dispose();

    expect(player.disposed).toBe(true);
    expect(voice.disposed).toBe(true);
    expect(source.disconnect).toHaveBeenCalledTimes(1);
    expect(gain.disconnect).toHaveBeenCalledTimes(1);
    expect(output.disconnect).toHaveBeenCalledTimes(1);
    expect(onstop).toHaveBeenCalledExactlyOnceWith(voice);
  });

  it("fires onstop once when a voice naturally ends", () => {
    const context = createMockContext(2);
    const onstop = vi.fn<StopCallback>();
    const player = new Player(context, createMockBuffer(2), { onStop: onstop });

    const voice = player.start({ time: 3 });
    const source = asMock<MockBufferSourceNode>(voice.source);

    source.onended?.();
    source.onended?.();
    voice.dispose();

    expect(voice.disposed).toBe(true);
    expect(player.activeVoices).toHaveLength(0);
    expect(onstop).toHaveBeenCalledExactlyOnceWith(voice);
  });
});
