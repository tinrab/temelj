import { describe, expect, it } from "vitest";

import {
  MockBiquadFilterNode,
  MockConstantSourceNode,
  MockGainNode,
  MockOscillatorNode,
  createMockAudioContext as createMockContext,
  asMock,
} from "../../tests/audio.ts";
import { MetalSynth } from "../mod.ts";

describe("MetalSynth", () => {
  it("triggers a metal synth with inharmonic FM oscillators", () => {
    const context = createMockContext(2);

    const metal = new MetalSynth(context, {
      envelope: { attack: 0.01, decay: 0.1, release: 0.2 },
      harmonicity: 2,
      modulationIndex: 4,
      octaves: 2,
      resonance: 2_000,
      volume: 0.5,
    });

    const output = asMock<MockGainNode>(metal.output);

    expect(output.gain.value).toBe(0.5);
    expect(metal.harmonicity).toBe(2);
    expect(metal.modulationIndex).toBe(4);
    expect(metal.octaves).toBe(2);
    expect(metal.resonance).toBe(2_000);
    expect(metal.state).toBe("stopped");
    expect(metal.state).toBe("stopped");

    const voice = metal.triggerAttack("A4", { time: 3, velocity: 0.75 });
    const highpass = asMock<MockBiquadFilterNode>(voice.highpass);
    const amplitude = asMock<MockGainNode>(voice.amplitude);
    const first = voice.oscillators[0]!;
    const second = voice.oscillators[1]!;
    const firstSource = asMock<MockConstantSourceNode>(first.frequency);
    const secondSource = asMock<MockConstantSourceNode>(second.frequency);
    const firstCarrier = asMock<MockOscillatorNode>(first.carrier);
    const firstModulator = asMock<MockOscillatorNode>(first.modulator);
    const firstModulationGain = asMock<MockGainNode>(first.modulationGain);

    expect(voice.oscillators).toHaveLength(6);
    expect(firstSource.offset.value).toBe(440);
    expect(secondSource.offset.value).toBeCloseTo(440 * 1.483, 12);
    expect(firstCarrier.type).toBe("square");
    expect(firstModulator.type).toBe("square");
    expect(firstModulator.frequency.value).toBe(880);
    expect(firstModulationGain.gain.value).toBe(1_760);
    expect(firstCarrier.connect).toHaveBeenCalledWith(highpass);
    expect(highpass.type).toBe("highpass");
    expect(highpass.frequency.value).toBe(2_000);
    expect(highpass.connect).toHaveBeenCalledWith(amplitude);
    expect(amplitude.connect).toHaveBeenCalledWith(output);
    expect(highpass.frequency.setValueAtTime).toHaveBeenCalledWith(2_000, 3);
    expect(highpass.frequency.linearRampToValueAtTime).toHaveBeenCalledWith(8_000, 3.01);
    expect(highpass.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(2_000, 3.11);
    expect(amplitude.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.75, 3.01);
    expect(firstSource.start).toHaveBeenCalledWith(3);
    expect(firstCarrier.start).toHaveBeenCalledWith(3);
    expect(firstModulator.start).toHaveBeenCalledWith(3);
    expect(firstCarrier.stop).toHaveBeenCalledWith(3.11);
    expect(metal.state).toBe("started");
    expect(metal.state).toBe("started");

    metal.setHarmonicity(3);
    metal.setModulationIndex(5);
    metal.setOctaves(1);
    metal.setResonance(1_000);

    expect(metal.harmonicity).toBe(3);
    expect(metal.modulationIndex).toBe(5);
    expect(metal.octaves).toBe(1);
    expect(metal.resonance).toBe(1_000);
    expect(firstModulator.frequency.setValueAtTime).toHaveBeenCalledWith(1_320, 2);
    expect(firstModulationGain.gain.setValueAtTime).toHaveBeenCalledWith(2_200, 2);

    voice.release(4);

    expect(amplitude.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.000_001, 4.2);
    expect(firstCarrier.stop).toHaveBeenCalledWith(4.2);

    voice.dispose();
    expect(metal.activeVoices).toHaveLength(0);
    expect(metal.state).toBe("stopped");
    expect(metal.state).toBe("stopped");

    metal.dispose();
    expect(output.disconnect).toHaveBeenCalled();
  });
});
