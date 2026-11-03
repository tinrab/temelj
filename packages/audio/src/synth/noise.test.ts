import { describe, expect, it } from "vitest";

import {
  MockBiquadFilterNode,
  MockBufferSourceNode,
  MockGainNode,
  createMockAudioContext as createMockContext,
  asMock,
} from "../../tests/audio.ts";
import { NoiseSynth } from "../mod.ts";

describe("NoiseSynth", () => {
  it("triggers a filtered noise synth voice through an amplitude envelope", () => {
    const context = createMockContext(2);

    const synth = new NoiseSynth(context, {
      envelope: { attack: 0.01, decay: 0.05, release: 0.2, sustain: 0.1 },
      filter: { frequency: 1_200, Q: 2, type: "bandpass" },
      noise: { duration: 0.25, seed: 123, type: "pink" },
      volume: 0.6,
    });

    const output = asMock<MockGainNode>(synth.output);

    expect(output.gain.value).toBe(0.6);
    expect(synth.state).toBe("stopped");
    expect(synth.state).toBe("stopped");

    const voice = synth.triggerAttack({ time: 3, velocity: 0.7 });
    const source = asMock<MockBufferSourceNode>(voice.source);
    const filter = asMock<MockBiquadFilterNode>(voice.filter);
    const voiceGain = context.createdGains[1]!;

    expect(source.loop).toBe(true);
    expect(source.buffer?.length).toBe(12_000);
    expect(filter.type).toBe("bandpass");
    expect(filter.frequency.value).toBe(1_200);
    expect(filter.Q.value).toBe(2);
    expect(source.connect).toHaveBeenCalledWith(filter);
    expect(filter.connect).toHaveBeenCalledWith(voiceGain);
    expect(voiceGain.connect).toHaveBeenCalledWith(output);
    expect(voiceGain.gain.setValueAtTime).toHaveBeenCalledWith(0, 3);
    expect(voiceGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.7, 3.01);
    const decayCall = voiceGain.gain.exponentialRampToValueAtTime.mock.calls.at(0);
    expect(decayCall?.[0]).toBeCloseTo(0.07, 12);
    expect(decayCall?.[1]).toBeCloseTo(3.06, 12);
    expect(source.start).toHaveBeenCalledWith(3);
    expect(synth.state).toBe("started");
    expect(synth.state).toBe("started");

    voice.release(4);

    expect(voiceGain.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.000_001, 4.2);
    expect(source.stop).toHaveBeenCalledWith(4.2);

    voice.dispose();

    expect(source.disconnect).toHaveBeenCalled();
    expect(filter.disconnect).toHaveBeenCalled();
    expect(voiceGain.disconnect).toHaveBeenCalled();
    expect(synth.activeVoices).toHaveLength(0);
    expect(synth.state).toBe("stopped");
    expect(synth.state).toBe("stopped");
  });

  it("supports noise synth attack-release and release-all", () => {
    const context = createMockContext(2);

    const synth = new NoiseSynth(context, {
      envelope: { release: 0.25 },
      noise: { duration: 0.1, type: "white" },
    });

    const first = synth.triggerAttackRelease("8n", { time: 3 });
    const second = synth.triggerAttack({ time: 4 });

    expect(asMock<MockBufferSourceNode>(first.source).stop).toHaveBeenCalledWith(3.5);
    expect(synth.activeVoices).toHaveLength(2);

    synth.triggerRelease({ time: 5 });

    expect(asMock<MockBufferSourceNode>(second.source).stop).toHaveBeenCalledWith(5.25);

    synth.dispose();

    expect(synth.activeVoices).toHaveLength(0);
    expect(asMock<MockGainNode>(synth.output).disconnect).toHaveBeenCalled();
  });
});
