import { describe, expect, it } from "vitest";

import {
  MockGainNode,
  MockOscillatorNode,
  createMockAudioContext as createMockContext,
  asMock,
} from "../../tests/audio.ts";
import { Synth } from "../mod.ts";

describe("Synth", () => {
  it("triggers a synth voice through an amplitude envelope", () => {
    const context = createMockContext(2);

    const synth = new Synth(context, {
      envelope: { attack: 0.01, decay: 0.2, release: 0.5, sustain: 0.25 },
      oscillator: { type: "square" },
      volume: 0.75,
    });

    const output = asMock<MockGainNode>(synth.output);

    expect(synth.state).toBe("stopped");
    expect(synth.state).toBe("stopped");
    expect(output.gain.value).toBe(0.75);

    const voice = synth.triggerAttack("C4", { time: 3, velocity: 0.8 });
    const oscillator = asMock<MockOscillatorNode>(voice.oscillator);
    const voiceGain = context.createdGains[1]!;

    expect(oscillator.frequency.value).toBeCloseTo(261.6255653005986, 12);
    expect(oscillator.type).toBe("square");
    expect(oscillator.connect).toHaveBeenCalledWith(voiceGain);
    expect(voiceGain.connect).toHaveBeenCalledWith(output);
    expect(voiceGain.gain.setValueAtTime).toHaveBeenCalledWith(0, 3);
    expect(voiceGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.8, 3.01);
    expect(voiceGain.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.2, 3.21);
    expect(oscillator.start).toHaveBeenCalledWith(3);
    expect(synth.activeVoices).toHaveLength(1);
    expect(synth.state).toBe("started");
    expect(synth.state).toBe("started");

    synth.triggerRelease("C4", { time: 4 });
    expect(voiceGain.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.000_001, 4.5);
    expect(oscillator.stop).toHaveBeenCalledWith(4.5);

    voice.dispose();
    expect(oscillator.disconnect).toHaveBeenCalled();
    expect(voiceGain.disconnect).toHaveBeenCalled();
    expect(synth.activeVoices).toHaveLength(0);
    expect(synth.state).toBe("stopped");
    expect(synth.state).toBe("stopped");
  });

  it("triggers attack-release notes and disposes active voices", () => {
    const context = createMockContext(2);

    const synth = new Synth(context, {
      envelope: { release: 0.25 },
    });

    const voice = synth.triggerAttackRelease(69, "8n", { time: 3 });
    const oscillator = asMock<MockOscillatorNode>(voice.oscillator);

    expect(oscillator.frequency.value).toBe(440);
    expect(oscillator.start).toHaveBeenCalledWith(3);
    expect(oscillator.stop).toHaveBeenCalledWith(3.5);

    synth.dispose();
    expect(synth.activeVoices).toHaveLength(0);
  });

  it("rejects invalid note values", () => {
    const context = createMockContext();
    const synth = new Synth(context);

    expect(() => synth.triggerAttack("H4")).toThrow(RangeError);
    expect(() => synth.triggerAttack(-1)).toThrow(RangeError);
  });
});
