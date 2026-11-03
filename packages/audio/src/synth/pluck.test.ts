import { describe, expect, it } from "vitest";

import {
  MockBiquadFilterNode,
  MockBufferSourceNode,
  MockDelayNode,
  MockGainNode,
  createMockAudioContext as createMockContext,
  asMock,
} from "../../tests/audio.ts";
import { PluckSynth } from "../mod.ts";

describe("PluckSynth", () => {
  it("triggers a pluck synth voice through a lowpass comb graph", () => {
    const context = createMockContext(2);

    const synth = new PluckSynth(context, {
      attackNoise: 2,
      dampening: 3_000,
      noise: { seed: 42, type: "white" },
      release: 0.5,
      resonance: 0.8,
      volume: 0.4,
    });

    const output = asMock<MockGainNode>(synth.output);

    expect(synth.attackNoise).toBe(2);
    expect(synth.dampening).toBe(3_000);
    expect(synth.resonance).toBe(0.8);
    expect(synth.state).toBe("stopped");
    expect(synth.state).toBe("stopped");
    expect(output.gain.value).toBe(0.4);

    const voice = synth.triggerAttack("A4", { time: 3, velocity: 0.6 });
    const source = asMock<MockBufferSourceNode>(voice.source);
    const delay = asMock<MockDelayNode>(voice.delay);
    const filter = asMock<MockBiquadFilterNode>(voice.dampening);
    const feedback = asMock<MockGainNode>(voice.feedback);
    const voiceOutput = context.createdGains[2]!;

    expect(source.buffer?.length).toBeCloseTo(Math.floor((2 / 440) * 48_000), 0);
    expect(delay.delayTime.value).toBeCloseTo(1 / 440, 12);
    expect(delay.delayTime.setValueAtTime).toHaveBeenCalledWith(1 / 440, 3);
    expect(filter.type).toBe("lowpass");
    expect(filter.frequency.value).toBe(3_000);
    expect(feedback.gain.value).toBe(0.8);
    expect(feedback.gain.setValueAtTime).toHaveBeenCalledWith(0.8, 3);
    expect(voiceOutput.gain.value).toBe(0.6);
    expect(source.connect).toHaveBeenCalledWith(delay);
    expect(delay.connect).toHaveBeenCalledWith(filter);
    expect(filter.connect.mock.calls).toEqual([[feedback], [voiceOutput]]);
    expect(feedback.connect).toHaveBeenCalledWith(delay);
    expect(voiceOutput.connect).toHaveBeenCalledWith(output);
    expect(source.start).toHaveBeenCalledWith(3);
    expect(source.stop).toHaveBeenCalledWith(3 + (1 / 440) * 2);
    expect(synth.state).toBe("started");
    expect(synth.state).toBe("started");

    voice.release(4);

    expect(feedback.gain.cancelScheduledValues).toHaveBeenCalledWith(4);
    expect(feedback.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 4.5);
  });

  it("supports pluck synth attack-release, note release, disposal, and validation", () => {
    const context = createMockContext(2);

    const synth = new PluckSynth(context, {
      release: 0.25,
      resonance: 2,
    });

    expect(synth.resonance).toBe(1);

    const first = synth.triggerAttackRelease("C4", "8n", { time: 3 });
    const second = synth.triggerAttack("E4", { time: 4 });

    expect(asMock<MockGainNode>(first.feedback).gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0,
      3.5,
    );
    expect(
      asMock<MockGainNode>(second.feedback).gain.linearRampToValueAtTime,
    ).not.toHaveBeenCalled();

    synth.triggerRelease("E4", { time: 5 });

    expect(asMock<MockGainNode>(second.feedback).gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      0,
      5.25,
    );
    expect(synth.activeVoices).toHaveLength(2);

    first.dispose();
    second.dispose();

    expect(synth.activeVoices).toHaveLength(0);
    expect(synth.state).toBe("stopped");
    expect(synth.state).toBe("stopped");
    expect(() => new PluckSynth(context, { attackNoise: 0 })).toThrow("attackNoise");

    synth.dispose();

    expect(asMock<MockGainNode>(synth.output).disconnect).toHaveBeenCalled();
  });
});
