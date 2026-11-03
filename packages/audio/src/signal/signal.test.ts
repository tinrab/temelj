import { describe, expect, it } from "vitest";

import { gain, oscillator } from "../graph/blueprint.ts";
import {
  abs,
  add,
  audioToGain,
  createAbsCurve,
  createGreaterThanZeroCurve,
  gainToAudio,
  greaterThan,
  multiply,
  negate,
  pow,
  scale,
  signal,
  SignalBlueprint,
  subtract,
  zero,
} from "./signal.ts";

describe("signals", () => {
  it("folds constant operands into constant signals", () => {
    expect(add(1, 2).options).toEqual({ offset: 3 });
    expect(subtract(5, 2).options).toEqual({ offset: 3 });
    expect(multiply(2, 3).options).toEqual({ offset: 6 });
    expect(negate(2).options).toEqual({ offset: -2 });
    expect(scale(0.5, 10, 20).options).toEqual({ offset: 15 });
    expect(audioToGain(0).options).toEqual({ offset: 0.5 });
    expect(gainToAudio(1).options).toEqual({ offset: 1 });
    expect(abs(-0.5).options).toEqual({ offset: 0.5 });
    expect(pow(-2, 2).options).toEqual({ offset: 4 });
    expect(zero().operation).toBe("zero");
  });

  it("exposes the offset param on constant signals", () => {
    const value = signal(0.25);

    expect(value).toBeInstanceOf(SignalBlueprint);
    expect(value.params.offset?.key).toBe("offset");
    expect(value.params.gain).toBeUndefined();
  });

  it("sums inputs without feeding back into them", () => {
    const source = oscillator();

    const sum = add(source, 1);

    expect(sum.operation).toBe("add");
    expect(sum.options).toEqual({ gain: 1 });
    expect(source.connections).toEqual([sum]);
    expect(sum.connections).toEqual([]);
    expect(sum.incoming.map((connection) => connection.source.type).sort()).toEqual([
      "oscillator",
      "signal",
    ]);
  });

  it("multiplies by modulating the output gain", () => {
    const carrier = oscillator();
    const modulator = oscillator();

    const product = multiply(carrier, modulator);

    expect(product.options).toEqual({ gain: 0 });
    expect(carrier.connections).toEqual([product]);
    expect(modulator.connections).toEqual([product.params.gain]);
    expect(multiply(carrier, 3).options).toEqual({ gain: 3 });
  });

  it("shapes inputs through waveshaper curves", () => {
    const input = gain();

    const absolute = abs(input, { samples: 3 });
    const above = greaterThan(input, 0.25, { samples: 3 });

    expect(absolute.options).toEqual({ curve: Float32Array.from([1, 0, 1]) });
    expect(above.operation).toBe("greaterThan");
    expect(above.sources).toEqual([input, 0.25]);
  });

  it("samples curves over the [-1, 1] domain", () => {
    expect([...createAbsCurve(3)]).toEqual([1, 0, 1]);
    expect([...createGreaterThanZeroCurve(3)]).toEqual([0, 0, 1]);
    expect(() => createAbsCurve(0)).toThrow("samples");
    expect(() => pow(gain(), -1)).toThrow("exponent");
  });
});
