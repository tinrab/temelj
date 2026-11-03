import { describe, expect, it } from "vitest";

import {
  MockGainNode,
  MockOscillatorNode,
  createMockAudioContext as createMockContext,
  asMock,
} from "../../tests/audio.ts";
import { MembraneSynth } from "../mod.ts";

describe("MembraneSynth", () => {
  it("triggers a membrane synth with a descending pitch envelope", () => {
    const context = createMockContext(2);

    const synth = new MembraneSynth(context, {
      envelope: { decay: 0.2, release: 0.3, sustain: 0.05 },
      octaves: 3,
      oscillator: { type: "sine" },
      pitchDecay: 0.04,
      volume: 0.5,
    });

    const output = asMock<MockGainNode>(synth.output);

    expect(synth.octaves).toBe(3);
    expect(synth.pitchDecay).toBe(0.04);
    expect(output.gain.value).toBe(0.5);
    expect(synth.state).toBe("stopped");
    expect(synth.state).toBe("stopped");

    const voice = synth.triggerAttack("A2", { time: 3, velocity: 0.8 });
    const oscillator = asMock<MockOscillatorNode>(voice.oscillator);
    const voiceGain = context.createdGains[1]!;
    const target = 110;
    const startFrequency = target * 2 ** 3;

    expect(oscillator.frequency.value).toBeCloseTo(target, 12);
    expect(oscillator.frequency.setValueAtTime).toHaveBeenCalledWith(startFrequency, 3);
    expect(oscillator.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(target, 3.04);
    expect(oscillator.type).toBe("sine");
    expect(oscillator.connect).toHaveBeenCalledWith(voiceGain);
    expect(voiceGain.connect).toHaveBeenCalledWith(output);
    expect(voiceGain.gain.setValueAtTime).toHaveBeenCalledWith(0.000_001, 3);
    expect(voiceGain.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.8, 3.001);
    const decayCall = voiceGain.gain.exponentialRampToValueAtTime.mock.calls.at(1);
    expect(decayCall?.[0]).toBeCloseTo(0.04, 12);
    expect(decayCall?.[1]).toBeCloseTo(3.201, 12);
    expect(oscillator.start).toHaveBeenCalledWith(3);
    expect(synth.state).toBe("started");
    expect(synth.state).toBe("started");
  });

  it("supports membrane synth attack-release, note release, disposal, and validation", () => {
    const context = createMockContext(2);

    const synth = new MembraneSynth(context, {
      envelope: { release: 0.25 },
      pitchDecay: "16n",
    });

    const first = synth.triggerAttackRelease("C2", "8n", { time: 3 });
    const second = synth.triggerAttack("E2", { time: 4 });

    expect(asMock<MockOscillatorNode>(first.oscillator).stop).toHaveBeenCalledWith(3.5);
    expect(asMock<MockOscillatorNode>(second.oscillator).stop).not.toHaveBeenCalled();

    synth.triggerRelease("E2", { time: 5 });

    expect(asMock<MockOscillatorNode>(second.oscillator).stop).toHaveBeenCalledWith(5.25);
    expect(synth.activeVoices).toHaveLength(2);

    first.dispose();
    second.dispose();

    expect(synth.activeVoices).toHaveLength(0);
    expect(() => new MembraneSynth(context, { octaves: 0 })).toThrow("octaves");

    const invalidPitchDecay = new MembraneSynth(context, { pitchDecay: -1 });
    expect(() => invalidPitchDecay.triggerAttack("C2")).toThrow("pitchDecay");

    synth.dispose();
    expect(asMock<MockGainNode>(synth.output).disconnect).toHaveBeenCalled();
  });
});
