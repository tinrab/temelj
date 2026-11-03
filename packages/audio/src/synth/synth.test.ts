import { describe, expect, it } from "vitest";

import {
  MockGainNode,
  createMockAudioContext as createMockContext,
  asMock,
} from "../../tests/audio.ts";
import {
  AMSynth,
  DuoSynth,
  FMSynth,
  MembraneSynth,
  MetalSynth,
  MonoSynth,
  NoiseSynth,
  PluckSynth,
  PolySynth,
  Synth,
  type NoteVoice,
} from "../mod.ts";

describe("synths", () => {
  it("applies output mute and volume for every synth", () => {
    const context = createMockContext(2);
    const options = { mute: true, volume: 0.5 };

    const synths = [
      new Synth(context, options),
      new FMSynth(context, options),
      new AMSynth(context, options),
      new MonoSynth(context, options),
      new DuoSynth(context, options),
      new MetalSynth(context, options),
      new MembraneSynth(context, options),
      new NoiseSynth(context, options),
      new PluckSynth(context, options),
      new PolySynth(context, options),
    ];

    for (const synth of synths) {
      const output = asMock<MockGainNode>(synth.output);

      expect(synth.mute).toBe(true);
      expect(output.gain.value).toBe(0);
      synth.setMute(false, 3);
      expect(synth.mute).toBe(false);
      expect(output.gain.setValueAtTime).toHaveBeenCalledWith(0.5, 3);
      synth.setVolume(0.25, 4);
      expect(output.gain.setValueAtTime).toHaveBeenCalledWith(0.25, 4);
      synth.setMute(true, 5);
      expect(output.gain.setValueAtTime).toHaveBeenCalledWith(0, 5);
      expect(() => synth.setVolume(-1)).toThrow(RangeError);
    }
  });

  it("removes each voice once its release has ended", () => {
    type FinishingSynth = {
      readonly activeVoices: readonly NoteVoice[];
      readonly state: string;
      triggerAttackRelease(note: string, duration: number): void;
    };

    const cases: [string, (context: ReturnType<typeof createMockContext>) => FinishingSynth][] = [
      ["Synth", (context) => new Synth(context)],
      ["FMSynth", (context) => new FMSynth(context)],
      ["AMSynth", (context) => new AMSynth(context)],
      ["MonoSynth", (context) => new MonoSynth(context)],
      ["DuoSynth", (context) => new DuoSynth(context)],
      ["MetalSynth", (context) => new MetalSynth(context)],
      ["MembraneSynth", (context) => new MembraneSynth(context)],
      ["PluckSynth", (context) => new PluckSynth(context)],
      ["PolySynth", (context) => new PolySynth(context)],
    ];

    const results = cases.map(([name, create]) => {
      const context = createMockContext(2);
      const synth = create(context);
      synth.triggerAttackRelease("C4", 0.1);
      const playing = synth.activeVoices.length;

      for (const source of [
        ...context.createdOscillators,
        ...context.createdSources,
        ...context.createdConstantSources,
      ]) {
        source.dispatchEnded();
      }

      return { after: synth.activeVoices.length, name, playing, state: synth.state };
    });

    expect(results).toEqual(
      cases.map(([name]) => ({ after: 0, name, playing: 1, state: "stopped" })),
    );

    const noiseContext = createMockContext(2);
    const noise = new NoiseSynth(noiseContext);
    noise.triggerAttackRelease(0.1);
    expect(noise.activeVoices).toHaveLength(1);

    for (const source of noiseContext.createdSources) {
      source.dispatchEnded();
    }

    expect(noise.activeVoices).toHaveLength(0);
  });

  it("exposes disposal state for all synth helpers", () => {
    const context = createMockContext(2);

    const synths = [
      new Synth(context),
      new FMSynth(context),
      new AMSynth(context),
      new MonoSynth(context),
      new DuoSynth(context),
      new MetalSynth(context),
      new MembraneSynth(context),
      new NoiseSynth(context),
      new PluckSynth(context),
      new PolySynth(context),
    ];

    for (const synth of synths) {
      expect(synth.disposed).toBe(false);
      synth.dispose();
      synth.dispose();
      expect(synth.disposed).toBe(true);
      expect(synth.state).toBe("stopped");
      expect(synth.state).toBe("stopped");
    }
  });

  it("exposes disposal state for synth voice handles", () => {
    const context = createMockContext(2);

    const voices = [
      new Synth(context).triggerAttack("C4"),
      new FMSynth(context).triggerAttack("C4"),
      new AMSynth(context).triggerAttack("C4"),
      new MonoSynth(context).triggerAttack("C4"),
      new DuoSynth(context).triggerAttack("C4"),
      new MetalSynth(context).triggerAttack("C4"),
      new MembraneSynth(context).triggerAttack("C2"),
      new NoiseSynth(context).triggerAttack(),
      new PluckSynth(context).triggerAttack("C4"),
      ...new PolySynth(context).triggerAttack(["C4", "E4"]),
    ];

    for (const voice of voices) {
      expect(voice.disposed).toBe(false);
      voice.dispose();
      voice.dispose();
      expect(voice.disposed).toBe(true);
    }
  });
});
