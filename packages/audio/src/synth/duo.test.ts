import { describe, expect, it } from "vitest";

import {
  MockGainNode,
  MockOscillatorNode,
  createMockAudioContext as createMockContext,
  asMock,
} from "../../tests/audio.ts";
import { DuoSynth } from "../mod.ts";

describe("DuoSynth", () => {
  it("triggers a duo synth with harmonicity and vibrato detune routing", () => {
    const context = createMockContext(2);

    const duo = new DuoSynth(context, {
      detune: 7,
      harmonicity: 2,
      vibratoAmount: 0.25,
      vibratoRate: 6,
      voice0: { oscillator: { type: "sawtooth" } },
      voice1: { oscillator: { type: "square" } },
      volume: 0.8,
    });

    const output = asMock<MockGainNode>(duo.output);
    const vibrato = asMock<MockOscillatorNode>(duo.vibrato);
    const vibratoDepth = asMock<MockGainNode>(duo.vibratoDepth);

    expect(output.gain.value).toBe(0.8);
    expect(duo.harmonicity).toBe(2);
    expect(duo.detune).toBe(7);
    expect(vibrato.frequency.value).toBe(6);
    expect(vibratoDepth.gain.value).toBe(12.5);
    expect(vibrato.connect).toHaveBeenCalledWith(vibratoDepth);
    expect(duo.state).toBe("stopped");
    expect(duo.state).toBe("stopped");

    const voice = duo.triggerAttackRelease("A4", "8n", { time: 3, velocity: 0.6 });
    const voice0Oscillator = asMock<MockOscillatorNode>(voice.voice0.oscillator);
    const voice1Oscillator = asMock<MockOscillatorNode>(voice.voice1.oscillator);

    expect(voice0Oscillator.frequency.value).toBe(440);
    expect(voice1Oscillator.frequency.value).toBe(880);
    expect(voice0Oscillator.type).toBe("sawtooth");
    expect(voice1Oscillator.type).toBe("square");
    expect(voice0Oscillator.detune.setValueAtTime).toHaveBeenCalledWith(7, 3);
    expect(voice1Oscillator.detune.setValueAtTime).toHaveBeenCalledWith(7, 3);
    expect(vibratoDepth.connect).toHaveBeenCalledWith(voice0Oscillator.detune);
    expect(vibratoDepth.connect).toHaveBeenCalledWith(voice1Oscillator.detune);
    expect(vibrato.start).toHaveBeenCalledWith(3);
    expect(voice0Oscillator.stop).toHaveBeenCalledWith(3.75);
    expect(voice1Oscillator.stop).toHaveBeenCalledWith(3.75);
    expect(duo.activeVoices).toHaveLength(1);
    expect(duo.state).toBe("started");
    expect(duo.state).toBe("started");

    duo.setDetune(-12, 4);
    duo.setVibratoAmount(2, 5);
    duo.setVibratoRate(7, 6);

    expect(duo.detune).toBe(-12);
    expect(voice0Oscillator.detune.setValueAtTime).toHaveBeenCalledWith(-12, 4);
    expect(voice1Oscillator.detune.setValueAtTime).toHaveBeenCalledWith(-12, 4);
    expect(vibratoDepth.gain.setValueAtTime).toHaveBeenCalledWith(50, 5);
    expect(vibrato.frequency.setValueAtTime).toHaveBeenCalledWith(7, 6);

    voice.dispose();
    expect(duo.activeVoices).toHaveLength(0);
    expect(duo.state).toBe("stopped");
    expect(duo.state).toBe("stopped");

    duo.dispose();
    expect(vibrato.disconnect).toHaveBeenCalled();
    expect(vibratoDepth.disconnect).toHaveBeenCalled();
    expect(output.disconnect).toHaveBeenCalled();
  });
});
