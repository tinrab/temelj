import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  createMockAudioBuffer as createMockBuffer,
  createMockAudioContext as createMockContext,
  type MockGainNode,
  asMock,
} from "../../tests/audio.ts";
import { AudioDisposedError, SpritePlayer, SpriteVoice } from "../mod.ts";

describe("audio sprite player", () => {
  it("starts a named sprite at the expected offset and duration", () => {
    const context = createMockContext(2);
    const buffer = createMockBuffer(4);

    const sprites = {
      hit: [0.25, 0.5],
      loop: [1, 2, true],
    } as const;

    const player = new SpritePlayer(context, buffer, {
      fadeIn: 0.05,
      fadeOut: 0.1,
      sprites,
      volume: 0.8,
    });

    const voice = player.play("hit", { time: 3, volume: 0.4 });
    const source = context.createdSources[0]!;
    const gain = context.createdGains[1]!;

    expectTypeOf(player).toEqualTypeOf<SpritePlayer<"hit" | "loop">>();
    expectTypeOf(voice).toEqualTypeOf<SpriteVoice<"hit" | "loop">>();
    expect(player.names).toEqual(["hit", "loop"]);
    expect(voice.id).toBe(1);
    expect(voice.name).toBe("hit");
    expect(voice.offset).toBe(0.25);
    expect(voice.duration).toBe(0.5);
    expect(voice.state).toBe("started");
    expect(source.buffer).toBe(buffer);
    expect(source.start).toHaveBeenCalledWith(3, 0.25);
    expect(source.stop).toHaveBeenCalledWith(3.5);
    expect(source.connect).toHaveBeenCalledWith(gain);
    expect(gain.connect).toHaveBeenCalledWith(player.output);
    expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(0, 3);
    expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.4, 3.05);
  });

  it("loops a sprite only inside its region", () => {
    const context = createMockContext(2);

    const player = new SpritePlayer(context, createMockBuffer(4), {
      sprites: {
        bed: [1, 1.5, true],
      },
    });

    const voice = player.play("bed", { time: 3 });
    const source = context.createdSources[0]!;

    expect(voice.loop).toBe(true);
    expect(source.loop).toBe(true);
    expect(source.loopStart).toBe(1);
    expect(source.loopEnd).toBe(2.5);
    expect(source.start).toHaveBeenCalledWith(3, 1);

    context.currentTime = 4.75;
    expect(voice.progress).toBe(0.25);
  });

  it("stops individual voices by id and groups by name", () => {
    const context = createMockContext(2);

    const player = new SpritePlayer(context, createMockBuffer(4), {
      fadeOut: 0.2,
      sprites: {
        hit: [0, 0.5],
        snare: [1, 0.5],
      },
    });

    const first = player.play("hit", { time: 3 });
    const second = player.play("hit", { time: 3.5 });
    const third = player.play("snare", { time: 4 });

    player.stop(first.id, 5);

    expect(context.createdSources[0]?.stop).toHaveBeenCalledWith(5.2);
    expect(first.state).toBe("stopped");
    expect(player.activeVoices).toEqual([second, third]);

    player.stop("hit", 6);

    expect(context.createdSources[1]?.stop).toHaveBeenCalledWith(6.2);
    expect(player.activeVoices).toEqual([third]);

    player.stop();

    expect(player.activeVoices).toHaveLength(0);
  });

  it("keeps stopped sprite nodes connected until the scheduled stop ends", () => {
    const context = createMockContext(2);

    const player = new SpritePlayer(context, createMockBuffer(4), {
      fadeOut: 0.2,
      sprites: {
        hit: [0, 1],
      },
    });

    const voice = player.play("hit", { time: 3 });
    const source = context.createdSources[0]!;
    const gain = context.createdGains[1]!;

    voice.stop(5);

    expect(source.stop).toHaveBeenCalledWith(5.2);
    expect(source.disconnect).not.toHaveBeenCalled();
    expect(gain.disconnect).not.toHaveBeenCalled();
    expect(voice.source).toBeUndefined();

    source.onended?.();

    expect(source.disconnect).toHaveBeenCalledTimes(1);
    expect(gain.disconnect).toHaveBeenCalledTimes(1);
  });

  it("pauses, resumes, and seeks with a stable voice object", () => {
    const context = createMockContext(2);

    const player = new SpritePlayer(context, createMockBuffer(4), {
      sprites: {
        phrase: [1, 2],
      },
    });

    const voice = player.play("phrase", { time: 3 });
    const firstSource = context.createdSources[0]!;

    context.currentTime = 3.5;
    voice.pause(3.5);

    expect(voice.state).toBe("paused");
    expect(voice.progress).toBe(0.5);
    expect(firstSource.stop).toHaveBeenCalledWith(3.5);

    voice.resume(4);
    const resumedSource = context.createdSources[1]!;

    expect(voice.id).toBe(1);
    expect(voice.state).toBe("started");
    expect(resumedSource.start).toHaveBeenCalledWith(4, 1.5);
    expect(resumedSource.stop).toHaveBeenCalledWith(5.5);

    voice.seek(1.25, 5);
    const seekSource = context.createdSources[2]!;

    expect(voice.progress).toBe(1.25);
    expect(seekSource.start).toHaveBeenCalledWith(5, 2.25);
  });

  it("applies player and per-voice mute, volume, and rate controls", () => {
    const context = createMockContext(2);

    const player = new SpritePlayer(context, createMockBuffer(4), {
      sprites: {
        hit: [0, 1],
      },
      volume: 0.5,
    });

    const output = asMock<MockGainNode>(player.output);

    player.setVolume(0.25, 3);
    player.setMute(true, 4);
    player.setPlaybackRate(0.5);

    expect(player.volume).toBe(0.25);
    expect(output.gain.setValueAtTime).toHaveBeenCalledWith(0.25, 3);
    expect(output.gain.setValueAtTime).toHaveBeenCalledWith(0, 4);
    expect(player.playbackRate).toBe(0.5);

    const voice = player.play("hit", { time: 5 });
    const source = context.createdSources[0]!;
    const gain = context.createdGains[1]!;

    voice.setVolume(0.75, 6);
    voice.setMute(true, 7);
    voice.setPlaybackRate(2, 8);

    expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(0.75, 6);
    expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(0, 7);
    expect(source.playbackRate.setValueAtTime).toHaveBeenCalledWith(2, 8);
  });

  it("emits typed lifecycle events and unsubscribes listeners", () => {
    const context = createMockContext(2);

    const player = new SpritePlayer(context, createMockBuffer(4), {
      sprites: {
        hit: [0, 1],
      },
    });

    const events: string[] = [];

    const onStop = vi.fn<(event: { readonly voice: SpriteVoice<"hit"> }) => void>(({ voice }) => {
      events.push(`stop:${voice.id}`);
    });

    player.events.on("play", ({ voice }) => {
      events.push(`play:${voice.name}`);
    });
    player.events.on("pause", ({ voice }) => {
      events.push(`pause:${voice.id}`);
    });
    player.events.on("seek", ({ voice, offset }) => {
      events.push(`seek:${voice.id}:${offset}`);
    });
    player.events.on("stop", onStop);

    const voice = player.play("hit", { time: 3 });
    voice.pause(3.5);
    voice.seek(0.25, 4);
    player.events.off("stop", onStop);
    voice.stop(5);

    expect(events).toEqual(["play:hit", "pause:1", "seek:1:0.25"]);
    expect(onStop).not.toHaveBeenCalled();
  });

  it("cleans up active voices and output on dispose", () => {
    const context = createMockContext(2);

    const player = new SpritePlayer(context, createMockBuffer(4), {
      sprites: {
        hit: [0, 1],
      },
    });

    const voice = player.play("hit", { time: 3 });
    const output = asMock<MockGainNode>(player.output);
    const source = context.createdSources[0]!;
    const gain = context.createdGains[1]!;

    player.dispose();
    player.dispose();

    expect(player.disposed).toBe(true);
    expect(voice.disposed).toBe(true);
    expect(source.disconnect).toHaveBeenCalledTimes(1);
    expect(gain.disconnect).toHaveBeenCalledTimes(1);
    expect(output.disconnect).toHaveBeenCalledTimes(1);
    expect(() => player.play("hit")).toThrow(AudioDisposedError);
  });
});
