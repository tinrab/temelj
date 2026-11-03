/* oxlint-disable anti-slop/no-shape-in-symbol-names -- `WaveShaper` is the Web Audio API name (`WaveShaperNode`, `BaseAudioContext.createWaveShaper()`). */
import { describe, expect, it } from "vitest";

import {
  MockConstantSourceNode,
  MockGainNode,
  MockOscillatorNode,
  MockWaveShaperNode,
  createMockAudioContext as createMockContext,
  asMock,
} from "../../tests/audio.ts";
import { AMSynth, FMSynth } from "../mod.ts";

describe("FMSynth and AMSynth", () => {
  it("triggers an FM synth voice with modulation controls", () => {
    const context = createMockContext(2);

    const synth = new FMSynth(context, {
      envelope: { attack: 0.02, release: 0.3 },
      oscillator: {
        harmonicity: 2,
        modulationIndex: 4,
        modulationType: "triangle",
        type: "sine",
      },
      volume: 0.7,
    });

    expect(synth.state).toBe("stopped");
    expect(synth.state).toBe("stopped");
    const voice = synth.triggerAttack("A4", { time: 3, velocity: 0.5 });
    const frequencySource = asMock<MockConstantSourceNode>(voice.oscillator.frequency);
    const carrier = asMock<MockOscillatorNode>(voice.oscillator.carrier);
    const modulator = asMock<MockOscillatorNode>(voice.oscillator.modulator);
    const modulationGain = asMock<MockGainNode>(voice.oscillator.modulationGain);
    const voiceGain = context.createdGains.at(-1)!;
    const output = asMock<MockGainNode>(synth.output);

    expect(output.gain.value).toBe(0.7);
    expect(voice.oscillator.harmonicity).toBe(2);
    expect(voice.oscillator.modulationIndex).toBe(4);
    expect(frequencySource.offset.value).toBe(440);
    expect(carrier.frequency.value).toBe(0);
    expect(carrier.type).toBe("sine");
    expect(modulator.frequency.value).toBe(880);
    expect(modulator.type).toBe("triangle");
    expect(modulationGain.gain.value).toBe(1_760);
    expect(carrier.connect).toHaveBeenCalledWith(voiceGain);
    expect(voiceGain.connect).toHaveBeenCalledWith(output);
    expect(voiceGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.5, 3.02);
    expect(frequencySource.start).toHaveBeenCalledWith(3);
    expect(modulator.start).toHaveBeenCalledWith(3);
    expect(carrier.start).toHaveBeenCalledWith(3);
    expect(synth.state).toBe("started");
    expect(synth.state).toBe("started");

    voice.release(4);

    expect(carrier.stop).toHaveBeenCalledWith(4.3);
    expect(modulator.stop).toHaveBeenCalledWith(4.3);
    expect(frequencySource.stop).toHaveBeenCalledWith(4.3);

    voice.dispose();

    expect(synth.activeVoices).toHaveLength(0);
    expect(synth.state).toBe("stopped");
    expect(synth.state).toBe("stopped");
  });

  it("triggers an AM synth voice with modulation controls", () => {
    const context = createMockContext(2);

    const synth = new AMSynth(context, {
      envelope: { attack: 0.01, release: 0.2 },
      oscillator: {
        harmonicity: 1.5,
        modulationType: "sawtooth",
        type: "square",
      },
      volume: 0.6,
    });

    expect(synth.state).toBe("stopped");
    expect(synth.state).toBe("stopped");
    const voice = synth.triggerAttackRelease("A4", "8n", { time: 3, velocity: 0.75 });
    const carrier = asMock<MockOscillatorNode>(voice.oscillator.carrier);
    const modulator = asMock<MockOscillatorNode>(voice.oscillator.modulator);
    const modulationGain = asMock<MockGainNode>(voice.oscillator.modulationGain);
    const modulationScale = asMock<MockWaveShaperNode>(voice.oscillator.modulationScale);
    const voiceGain = context.createdGains.at(-1)!;

    expect(voice.oscillator.harmonicity).toBe(1.5);
    expect(carrier.frequency.value).toBe(440);
    expect(carrier.type).toBe("square");
    expect(modulator.frequency.value).toBe(660);
    expect(modulator.type).toBe("sawtooth");
    expect(modulationScale.curve).toBeInstanceOf(Float32Array);
    expect(modulationGain.connect).toHaveBeenCalledWith(voiceGain);
    expect(voiceGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.75, 3.01);
    expect(carrier.start).toHaveBeenCalledWith(3);
    expect(modulator.start).toHaveBeenCalledWith(3);
    expect(carrier.stop).toHaveBeenCalledWith(3.45);
    expect(modulator.stop).toHaveBeenCalledWith(3.45);
    expect(synth.state).toBe("started");
    expect(synth.state).toBe("started");

    synth.triggerRelease("A4", { time: 4 });
    voice.dispose();

    expect(synth.activeVoices).toHaveLength(0);
    expect(synth.state).toBe("stopped");
    expect(synth.state).toBe("stopped");
  });
});
