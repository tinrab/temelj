import { describe, expect, it, vi } from "vitest";

import {
  createMockAudioBuffer as createMockBuffer,
  createMockAudioContext as createMockContext,
  type MockBufferSourceNode,
  asMock,
  MockAudioNode,
} from "../../tests/audio.ts";
import { AudioGraphError, Sampler, type SamplerVoice } from "../mod.ts";

describe("Sampler", () => {
  it("repitches the closest sample and releases with a fade", async () => {
    const context = createMockContext(2);
    const c4 = createMockBuffer();
    const onStop = vi.fn<(voice: SamplerVoice) => void>();

    const sampler = await Sampler.load(
      context,
      { C4: c4, 67: createMockBuffer() },
      { attack: 0.05, curve: "linear", onStop, release: 0.2, volume: 0.75 },
    );

    expect(sampler.output.gain.value).toBe(0.75);
    expect(sampler.sampleNotes).toEqual([60, 67]);
    expect(sampler.state).toBe("stopped");

    const [voice] = sampler.triggerAttack("D4", { time: 3, velocity: 0.5 });
    const source = asMock<MockBufferSourceNode>(voice!.source);
    const gain = context.createdGains[1]!;

    expect(voice!.midi).toBe(62);
    expect(voice!.sampleMidi).toBe(60);
    expect(voice!.playbackRate).toBeCloseTo(2 ** (2 / 12), 12);
    expect(source.buffer).toBe(c4);
    expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.5, 3.05);
    expect(source.start).toHaveBeenCalledWith(3, 0);
    expect(sampler.state).toBe("started");

    sampler.triggerRelease("D4", { time: 4 });
    expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 4.2);
    expect(source.stop).toHaveBeenLastCalledWith(4.2);
    expect(sampler.state).toBe("stopped");
    expect(onStop).toHaveBeenCalledExactlyOnceWith(voice);

    voice!.dispose();
    source.onended?.();
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("pairs duration arrays with note arrays and plays the attack before looping", async () => {
    const context = createMockContext(2);

    const sampler = await Sampler.load(
      context,
      { C4: createMockBuffer() },
      { loop: true, loopEnd: "4n", loopStart: "8n", release: 0.1 },
    );

    const voices = sampler.triggerAttackRelease(["C4", "E4"], ["8n", "4n"], { time: 3 });
    const first = asMock<MockBufferSourceNode>(voices[0]!.source);
    const second = asMock<MockBufferSourceNode>(voices[1]!.source);

    expect(first.loop).toBe(true);
    expect(first.loopStart).toBe(0.25);
    expect(first.loopEnd).toBe(0.5);
    expect(first.start).toHaveBeenCalledWith(3, 0);
    expect(first.stop).toHaveBeenCalledWith(3.35);
    expect(second.stop).toHaveBeenCalledWith(3.6);
    expect(() => sampler.triggerAttackRelease("C4", ["8n", "4n"])).toThrow(RangeError);
  });

  it("updates loop settings on playing voices and validates loop points", async () => {
    const context = createMockContext(2);
    const sampler = await Sampler.load(context, { C4: createMockBuffer(1) });
    const [voice] = sampler.triggerAttack("C4", { time: 3 });
    const source = asMock<MockBufferSourceNode>(voice!.source);

    sampler.setLoop(true);
    sampler.setLoopPoints("16n", "4n");
    expect(source.loop).toBe(true);
    expect(source.loopStart).toBe(0.125);
    expect(source.loopEnd).toBe(0.5);
    expect(() => sampler.setLoopPoints(0.2, 2)).toThrow(RangeError);
    await expect(
      Sampler.load(context, { C4: createMockBuffer(1) }, { loopStart: 2 }),
    ).rejects.toThrow(RangeError);
  });

  it("releases every voice and disposes once", async () => {
    const context = createMockContext(2);
    const onStop = vi.fn<(voice: SamplerVoice) => void>();
    const sampler = new Sampler(context, { onStop });
    await sampler.add("A4", createMockBuffer());

    sampler.triggerAttack(["A4", 72], { time: 3 });
    expect(sampler.activeVoices).toHaveLength(2);

    sampler.triggerRelease(undefined, { time: 4 });
    expect(sampler.activeVoices).toHaveLength(0);
    expect(onStop).toHaveBeenCalledTimes(2);

    sampler.dispose();
    sampler.dispose();
    expect(sampler.sampleNotes).toEqual([]);
    expect(asMock<MockAudioNode>(sampler.output).disconnect).toHaveBeenCalledTimes(1);
  });

  it("rejects playback without samples and invalid notes", () => {
    const sampler = new Sampler(createMockContext());

    expect(() => sampler.triggerAttack("C4")).toThrow(AudioGraphError);
    expect(() => sampler.triggerAttack("H4")).toThrow(RangeError);
  });
});
