import { describe, expect, expectTypeOf, it } from "vitest";

import { createMockAudioContext } from "../../tests/audio.ts";
import { chain, destination, oscillator } from "../graph/blueprint.ts";
import { patch } from "../graph/patch.ts";
import { startLfo } from "../signal/lfo.ts";
import { dubDelay, feedbackDelay, type FeedbackDelayBlueprint } from "./delay.ts";
import { createEffect } from "./effect.ts";
import { autoFilter, chorus, phaser, vibrato, type PhaserBlueprint } from "./lfo.ts";
import { autoPanner, ringModulator, tremolo } from "./modulation.ts";
import { quadrafuzz } from "./quadrafuzz.ts";

describe("createEffect", () => {
  it("dispatches by effect type with a matching return type", () => {
    const delayEffect = createEffect("feedbackDelay", { feedback: 0.5 });
    const phaserEffect = createEffect("phaser", { stages: 2 });

    expectTypeOf(delayEffect).toEqualTypeOf<FeedbackDelayBlueprint>();
    expectTypeOf(phaserEffect).toEqualTypeOf<PhaserBlueprint>();
    expect(delayEffect.feedback.options).toEqual({ gain: 0.5 });
    expect(phaserEffect.filters).toHaveLength(2);
  });

  it("creates waveshaper effects from generated curves unless one is given", () => {
    const curve = Float32Array.from([0, 1]);

    expect(createEffect("distortion", { samples: 4 }).options?.curve).toHaveLength(4);
    expect(createEffect("bitCrusher", { bits: 2, samples: 8 }).options?.curve).toHaveLength(8);
    expect(createEffect("softClip", { curve }).options?.curve).toBe(curve);
    expect(createEffect("filter", { type: "highpass" }).type).toBe("biquadFilter");
  });
});

describe("modulated delays", () => {
  it("sweeps the delay time around its center with a zero intrinsic delay", () => {
    const effect = chorus({ delayTime: 0.01, depth: 0.5, feedback: 0.2 });

    expect(effect.options).toEqual({ delayTime: 0, maxDelayTime: 0.03 });
    expect(effect.modulator.min).toBeCloseTo(0.005);
    expect(effect.modulator.max).toBeCloseTo(0.015);
    expect(effect.connections).toEqual([effect.feedback]);
    expect(effect.feedback.connections).toEqual([effect]);
    expect(effect.modulator.connections).toEqual([effect.params.delayTime]);
  });

  it("disables feedback for vibrato", () => {
    expect(vibrato().feedback.options).toEqual({ gain: 0 });
  });
});

describe("filter sweeps", () => {
  it("sweeps an auto filter from the base frequency across octaves", () => {
    const effect = autoFilter({ baseFrequency: 100, octaves: 1 });

    expect(effect.options.frequency).toBe(0);
    expect(effect.modulator.min).toBe(100);
    expect(effect.modulator.max).toBe(200);
  });

  it("routes phaser input into the first stage and out through its gain", () => {
    const effect = phaser({ stages: 3 });
    const source = oscillator();
    const output = destination();

    chain(source, effect, output);

    expect(source.connections).toEqual([effect.filters[0]]);
    expect(effect.filters[2]?.connections).toEqual([effect]);
    expect(effect.connections).toEqual([output]);
  });
});

describe("modulation effects", () => {
  it("modulates the target params of their output node", () => {
    const panner = autoPanner({ depth: 0.5 });
    const amp = tremolo({ depth: 0.25 });
    const ring = ringModulator({ frequency: 40 });

    expect(panner.modulator.connections).toEqual([panner.params.pan]);
    expect([amp.modulator.min, amp.modulator.max]).toEqual([0.75, 1]);
    expect(amp.options).toEqual({ gain: 0 });
    expect(ring.carrier.connections).toEqual([ring.params.gain]);
  });

  it("starts an effect modulator in a playback", () => {
    const context = createMockAudioContext(0);
    const effect = tremolo();
    const output = destination();
    effect.connect(output);

    patch(context, output).play((playContext) => {
      startLfo(playContext, effect.modulator, { time: 1 });
    });

    expect(context.createdOscillators[0]?.start).toHaveBeenCalledWith(1);
  });
});

describe("delay and distortion composites", () => {
  it("feeds a dub delay back through a low-pass filter", () => {
    const effect = dubDelay({ cutoff: 500, feedback: 0.4 });

    expect(effect.connections).toEqual([effect.filter]);
    expect(effect.filter.connections).toEqual([effect.feedback]);
    expect(effect.feedback.connections).toEqual([effect]);
    expect(feedbackDelay().feedback.options).toEqual({ gain: 0.35 });
  });

  it("splits quadrafuzz input into four shaped bands", () => {
    const effect = quadrafuzz({ samples: 8 });
    const source = oscillator();

    source.connect(effect);

    expect(source.connections).toEqual([effect.input]);
    expect(effect.input.connections).toHaveLength(4);
    expect(effect.incoming).toHaveLength(4);
  });
});
