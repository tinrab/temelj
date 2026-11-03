import { describe, expect, it } from "vitest";

import {
  MockGainNode,
  MockOscillatorNode,
  createMockAudioContext as createMockContext,
  asMock,
  asNative,
} from "../../tests/audio.ts";
import { AudioRangeError } from "../errors.ts";
import { PolySynth } from "../mod.ts";

describe("PolySynth", () => {
  it("allocates poly synth voices and steals the oldest voice at max polyphony", () => {
    const context = createMockContext(2);

    const poly = new PolySynth(context, {
      maxPolyphony: 2,
      oscillator: { type: "triangle" },
    });

    const destination = asNative<AudioNode>({});

    poly.connect(destination);
    expect(asMock<MockGainNode>(poly.output).connect).toHaveBeenCalledWith(destination);
    expect(poly.state).toBe("stopped");
    expect(poly.state).toBe("stopped");

    const [first] = poly.triggerAttack(["C4", "E4"], { time: 3 });
    expect(first).toBeDefined();
    expect(poly.activeVoices).toHaveLength(2);
    expect(poly.state).toBe("started");
    expect(poly.state).toBe("started");

    poly.triggerAttack("G4", { time: 4 });
    expect(poly.activeVoices).toHaveLength(2);
    expect(asMock<MockOscillatorNode>(first!.oscillator).stop).toHaveBeenCalled();
    expect(poly.activeVoices.map((voice) => voice.note)).toEqual(["E4", "G4"]);

    poly.triggerRelease("E4", { time: 5 });
    const released = asMock<MockOscillatorNode>(poly.activeVoices[0]?.oscillator);
    expect(released.stop).toHaveBeenCalled();

    poly.dispose();
    expect(poly.activeVoices).toHaveLength(0);
    expect(poly.state).toBe("stopped");
    expect(poly.state).toBe("stopped");
  });

  it("supports poly synth attack-release with per-note durations", () => {
    const context = createMockContext(2);

    const poly = new PolySynth(context, {
      envelope: { release: 0 },
      maxPolyphony: 4,
    });

    const voices = poly.triggerAttackRelease(["C4", "E4", "G4"], ["8n", "4n"], { time: 3 });

    expect(voices).toHaveLength(3);
    expect(asMock<MockOscillatorNode>(voices[0]!.oscillator).stop).toHaveBeenCalledWith(3.25);
    expect(asMock<MockOscillatorNode>(voices[1]!.oscillator).stop).toHaveBeenCalledWith(3.5);
    expect(asMock<MockOscillatorNode>(voices[2]!.oscillator).stop).toHaveBeenCalledWith(3.5);
  });

  it("requires poly synth duration arrays to pair with note arrays", () => {
    const context = createMockContext(2);
    const poly = new PolySynth(context);

    expect(() => poly.triggerAttackRelease("C4", ["8n", "4n"])).toThrow(AudioRangeError);
    expect(poly.activeVoices).toHaveLength(0);
  });

  it("releases duplicate poly synth notes one voice at a time", () => {
    const context = createMockContext(2);

    const poly = new PolySynth(context, {
      envelope: { release: 0 },
      maxPolyphony: 4,
    });

    const voices = poly.triggerAttack(["C4", "C4", "E4"], { time: 3 });

    poly.triggerRelease("C4", { time: 4 });

    expect(asMock<MockOscillatorNode>(voices[0]!.oscillator).stop).toHaveBeenCalledWith(4);
    expect(asMock<MockOscillatorNode>(voices[1]!.oscillator).stop).not.toHaveBeenCalled();
    expect(asMock<MockOscillatorNode>(voices[2]!.oscillator).stop).not.toHaveBeenCalled();

    poly.triggerRelease(["C4", "E4"], { time: 5 });

    expect(asMock<MockOscillatorNode>(voices[1]!.oscillator).stop).toHaveBeenCalledWith(5);
    expect(asMock<MockOscillatorNode>(voices[2]!.oscillator).stop).toHaveBeenCalledWith(5);
  });

  it("releases all active poly synth voices", () => {
    const context = createMockContext(2);

    const poly = new PolySynth(context, {
      envelope: { release: 0.25 },
      maxPolyphony: 4,
    });

    const voices = poly.triggerAttack(["C4", "E4", "G4"], { time: 3 });

    poly.releaseAll({ time: 5 });

    for (const voice of voices) {
      expect(asMock<MockOscillatorNode>(voice.oscillator).stop).toHaveBeenCalledWith(5.25);
    }
  });
});
