import { describe, expect, expectTypeOf, it } from "vitest";

import { createMockAudioBuffer } from "../../tests/audio.ts";
import { AudioGraphError, AudioRangeError } from "../errors.ts";
import {
  BlueprintParam,
  chain,
  crossFade,
  destination,
  fan,
  gain,
  group,
  iirFilter,
  master,
  oscillator,
  player,
  type GainBlueprint,
} from "./blueprint.ts";

describe("Blueprint", () => {
  it("records connections in both directions", () => {
    const source = oscillator({ frequency: 220 });
    const output = gain({ gain: 0.5 });

    source.connect(output, 0, 0);

    expect(source.connections).toEqual([output]);
    expect(source.outgoing).toEqual([{ destination: output, input: 0, output: 0, source }]);
    expect(output.incoming.map((connection) => connection.source)).toEqual([source]);
  });

  it("exposes typed params that connect to their owner", () => {
    const carrier = oscillator();
    const modulator = oscillator();

    modulator.connect(carrier.params.frequency);

    expect(carrier.params.frequency).toBeInstanceOf(BlueprintParam);
    expect(carrier.params.frequency.owner).toBe(carrier);
    expect(carrier.incoming.map((connection) => connection.source)).toEqual([modulator]);
    expectTypeOf(carrier.params).toHaveProperty("detune");
  });

  it("disconnects a destination or every outgoing connection", () => {
    const source = oscillator();
    const left = gain();
    const right = gain();
    fan(source, left, right);

    source.disconnect(left);
    expect(source.connections).toEqual([right]);
    expect(left.incoming).toEqual([]);

    source.disconnect();
    expect(source.connections).toEqual([]);
    expect(right.incoming).toEqual([]);
  });

  it("removes incoming and outgoing links on dispose without touching other nodes", () => {
    const source = oscillator();
    const middle = gain();
    const output = destination();
    chain(source, middle, output);

    middle.dispose();

    expect(source.connections).toEqual([]);
    expect(output.incoming).toEqual([]);
    expect(source.type).toBe("oscillator");
  });
});

describe("chain", () => {
  it("connects nodes in order and returns the last one", () => {
    const source = oscillator();
    const amp = gain();
    const output = destination();

    const last = chain(source, amp, output);

    expect(last).toBe(output);
    expect(source.connections).toEqual([amp]);
    expect(amp.connections).toEqual([output]);
    expectTypeOf(chain(source, amp)).toEqualTypeOf<GainBlueprint>();
  });
});

describe("composite blueprints", () => {
  it("sums group members without feeding back into them", () => {
    const first = oscillator();
    const second = oscillator();

    const mix = group([first, second], { gain: 0.5 });

    expect(mix.nodes).toEqual([first, second]);
    expect(first.connections).toEqual([mix]);
    expect(mix.connections).toEqual([]);
  });

  it("builds a player from a buffer source feeding its gain", () => {
    const buffer = createMockAudioBuffer();

    const track = player({ buffer, loop: true, volume: 0.8 });

    expect(track.type).toBe("player");
    expect(track.options).toEqual({ gain: 0.8 });
    expect(track.source.options).toEqual({ buffer, loop: true });
    expect(track.source.connections).toEqual([track]);
  });

  it("weights crossfade inputs by the fade amount", () => {
    const fade = crossFade({ fade: 0.25 });

    expect(fade.a.options).toEqual({ gain: 0.75 });
    expect(fade.b.options).toEqual({ gain: 0.25 });
    expect(fade.a.connections).toEqual([fade]);
  });

  it("resolves master volume and mute into a gain", () => {
    expect(master({ volume: 0.5 }).options).toEqual({ gain: 0.5 });
    expect(master({ muted: true, volume: 0.5 }).options).toEqual({ gain: 0 });
  });
});

describe("validation", () => {
  it("rejects invalid IIR coefficients and empty chains", () => {
    expect(() => iirFilter({ feedback: [0], feedforward: [1] })).toThrow(AudioRangeError);
    expect(() => iirFilter({ feedback: [1], feedforward: [] })).toThrow(AudioRangeError);
    expect(() => iirFilter({ feedback: [1], feedforward: [Number.NaN] })).toThrow(AudioRangeError);
    // @ts-expect-error -- chain requires at least one node.
    expect(() => chain()).toThrow(AudioGraphError);
  });
});
