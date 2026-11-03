import { describe, expect, it } from "vitest";

import {
  createMockAudioContext,
  MockAnalyserNode,
  MockBiquadFilterNode,
  MockGainNode,
  asMock,
} from "../../tests/audio.ts";
import { AutoWah } from "../mod.ts";

describe("AutoWah", () => {
  it("creates an envelope-followed wah filter graph", () => {
    const context = createMockAudioContext();

    const autoWah = new AutoWah(context, {
      baseFrequency: 200,
      follower: 0.1,
      gain: 4,
      octaves: 3,
      Q: 6,
      sensitivity: -20,
    });

    const input = asMock<MockGainNode>(autoWah.input);
    const inputBoost = context.createdGains[1]!;
    const analyser = asMock<MockAnalyserNode>(autoWah.analyser);
    const bandpass = asMock<MockBiquadFilterNode>(autoWah.bandpass);
    const peaking = asMock<MockBiquadFilterNode>(autoWah.peaking);

    expect(input.connect.mock.calls).toEqual([[bandpass], [inputBoost]]);
    expect(inputBoost.connect).toHaveBeenCalledWith(analyser);
    expect(bandpass.connect).toHaveBeenCalledWith(peaking);
    expect(autoWah.output).toBe(autoWah.peaking);
    expect(autoWah.baseFrequency).toBe(200);
    expect(autoWah.octaves).toBe(3);
    expect(autoWah.sweepMaxFrequency).toBe(1_600);
    expect(inputBoost.gain.value).toBeCloseTo(10, 12);
    expect(bandpass.type).toBe("bandpass");
    expect(bandpass.Q.value).toBe(6);
    expect(peaking.type).toBe("peaking");
    expect(peaking.gain.value).toBe(4);
    expect(bandpass.frequency.value).toBe(200);
    expect(peaking.frequency.value).toBe(200);
  });

  it("maps follower updates to the wah sweep range and exposes setters", () => {
    const context = createMockAudioContext();

    const autoWah = new AutoWah(context, {
      baseFrequency: 100,
      follower: 0.05,
      octaves: 2,
      sensitivity: 0,
    });

    const analyser = asMock<MockAnalyserNode>(autoWah.analyser);
    const bandpass = asMock<MockBiquadFilterNode>(autoWah.bandpass);
    const peaking = asMock<MockBiquadFilterNode>(autoWah.peaking);
    const inputBoost = context.createdGains[1]!;

    analyser.samples = [1, 1, 1, 1];
    autoWah.follower.reset(1);
    const frequency = autoWah.update(4);

    expect(frequency).toBe(400);
    expect(bandpass.frequency.setValueAtTime.mock.calls.at(-1)).toEqual([400, 4]);
    expect(peaking.frequency.setValueAtTime.mock.calls.at(-1)).toEqual([400, 4]);

    autoWah.setBaseFrequency(300, 5);
    autoWah.setOctaves(1, 6);
    autoWah.setQ(9, 7);
    autoWah.setGain(3, 8);
    autoWah.setSensitivity(-6);

    expect(autoWah.baseFrequency).toBe(300);
    expect(autoWah.octaves).toBe(1);
    expect(autoWah.sweepMaxFrequency).toBe(600);
    expect(bandpass.frequency.setValueAtTime.mock.calls.at(-1)).toEqual([300, 6]);
    expect(bandpass.Q.setValueAtTime.mock.calls.at(-1)).toEqual([9, 7]);
    expect(peaking.gain.setValueAtTime.mock.calls.at(-1)).toEqual([3, 8]);
    expect(inputBoost.gain.value).toBeCloseTo(1.9952623149688795, 12);
    expect(autoWah.sensitivity).toBe(-6);
    expect(autoWah.disposed).toBe(false);

    autoWah.dispose();
    autoWah.dispose();

    expect(autoWah.disposed).toBe(true);
    expect(asMock<MockGainNode>(autoWah.input).disconnect).toHaveBeenCalledTimes(1);
    expect(inputBoost.disconnect).toHaveBeenCalledTimes(1);
    expect(analyser.disconnect).toHaveBeenCalledTimes(1);
    expect(bandpass.disconnect).toHaveBeenCalledTimes(1);
    expect(peaking.disconnect).toHaveBeenCalledTimes(1);
  });
});
