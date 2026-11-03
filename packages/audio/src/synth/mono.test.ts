import { describe, expect, it } from "vitest";

import {
  MockBiquadFilterNode,
  MockGainNode,
  MockOscillatorNode,
  createMockAudioContext as createMockContext,
  asMock,
} from "../../tests/audio.ts";
import { MonoSynth } from "../mod.ts";

describe("MonoSynth", () => {
  it("triggers a mono synth voice through a filter envelope", () => {
    const context = createMockContext(2);

    const synth = new MonoSynth(context, {
      envelope: { attack: 0.01, release: 0.4 },
      filter: { Q: 3, type: "highpass" },
      filterEnvelope: {
        attack: 0.02,
        baseFrequency: 300,
        decay: 0.05,
        exponent: 1,
        octaves: 2,
        release: 0.25,
        sustain: 0.25,
      },
      oscillator: { type: "square" },
      volume: 0.55,
    });

    const output = asMock<MockGainNode>(synth.output);

    expect(output.gain.value).toBe(0.55);
    expect(synth.filterEnvelope.baseFrequency).toBe(300);
    expect(synth.state).toBe("stopped");
    expect(synth.state).toBe("stopped");

    const voice = synth.triggerAttack("A4", { time: 3, velocity: 0.5 });
    const oscillator = asMock<MockOscillatorNode>(voice.oscillator);
    const filter = asMock<MockBiquadFilterNode>(voice.filter);
    const voiceGain = context.createdGains.at(-1)!;

    expect(oscillator.frequency.value).toBe(440);
    expect(oscillator.type).toBe("square");
    expect(filter.type).toBe("highpass");
    expect(filter.Q.value).toBe(3);
    expect(oscillator.connect).toHaveBeenCalledWith(filter);
    expect(filter.connect).toHaveBeenCalledWith(voiceGain);
    expect(voiceGain.connect).toHaveBeenCalledWith(output);
    expect(filter.frequency.setValueAtTime).toHaveBeenCalledWith(300, 3);
    expect(filter.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(600, 3.02);
    expect(filter.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(375, 3.07);
    expect(voiceGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.5, 3.01);
    expect(oscillator.start).toHaveBeenCalledWith(3);
    expect(synth.state).toBe("started");
    expect(synth.state).toBe("started");

    voice.release(4);

    // The release starts from the sustain cutoff, not from whatever `value` reads when scheduled.
    expect(filter.frequency.setValueAtTime).toHaveBeenCalledWith(375, 4);
    expect(filter.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(300, 4.25);
    expect(voiceGain.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.000_001, 4.4);
    expect(oscillator.stop).toHaveBeenCalledWith(4.4);

    voice.dispose();

    expect(oscillator.disconnect).toHaveBeenCalled();
    expect(filter.disconnect).toHaveBeenCalled();
    expect(voiceGain.disconnect).toHaveBeenCalled();
    expect(synth.activeVoices).toHaveLength(0);
    expect(synth.state).toBe("stopped");
    expect(synth.state).toBe("stopped");
  });

  it("keeps mono synth monophonic and validates filter envelope values", () => {
    const context = createMockContext(2);

    const synth = new MonoSynth(context, {
      envelope: { release: 0 },
      filterEnvelope: { attack: 0, decay: 0, release: 0 },
      portamento: 0.05,
    });

    expect(synth.portamento).toBe(0.05);

    const first = synth.triggerAttack("C4", { time: 3 });
    const second = synth.triggerAttackRelease("E4", "8n", { time: 4 });

    expect(asMock<MockOscillatorNode>(first.oscillator).stop).toHaveBeenCalled();
    expect(synth.activeVoices).toEqual([second]);
    expect(asMock<MockOscillatorNode>(second.oscillator).stop).toHaveBeenCalledWith(4.25);

    expect(
      () =>
        new MonoSynth(context, {
          filterEnvelope: { baseFrequency: 0 },
        }),
    ).toThrow("baseFrequency");
  });
});
