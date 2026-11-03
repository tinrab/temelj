import { describe, expect, it, vi } from "vitest";

import { asNative, createMockFacade } from "../../tests/audio.ts";
import {
  AudioUnsupportedError,
  applyPeriodicWave,
  createPeriodicWave,
  createPeriodicWaveFromPartials,
} from "../mod.ts";

type PeriodicWaveCall = {
  readonly constraints?: PeriodicWaveConstraints;
  readonly imag: Float32Array;
  readonly real: Float32Array;
};

function createMockContext(): BaseAudioContext & {
  readonly calls: PeriodicWaveCall[];
  createPeriodicWave: (
    real: Float32Array,
    imag: Float32Array,
    constraints?: PeriodicWaveConstraints,
  ) => PeriodicWave;
} {
  const calls: PeriodicWaveCall[] = [];

  return asNative<
    BaseAudioContext & {
      readonly calls: PeriodicWaveCall[];
      createPeriodicWave: (
        real: Float32Array,
        imag: Float32Array,
        constraints?: PeriodicWaveConstraints,
      ) => PeriodicWave;
    }
  >({
    calls,
    currentTime: 0,
    destination: {},
    sampleRate: 44_100,
    state: "running",
    createPeriodicWave: vi.fn<
      (
        real: Float32Array,
        imag: Float32Array,
        constraints?: PeriodicWaveConstraints,
      ) => PeriodicWave
    >((real: Float32Array, imag: Float32Array, constraints?: PeriodicWaveConstraints) => {
      calls.push({ constraints, imag, real });

      return asNative<PeriodicWave>({ imag, real });
    }),
  });
}

describe("PeriodicWave utilities", () => {
  it("creates periodic waves from real and imaginary coefficients", () => {
    const context = createMockContext();
    const real = [0, 1, 0.5];
    const imag = new Float32Array([0, 0.25, 0.125]);

    const wave = createPeriodicWave(context, {
      disableNormalization: true,
      imag,
      real,
    });

    expect(wave).toBeDefined();
    expect(context.calls).toHaveLength(1);
    expect(Array.from(context.calls[0]!.real)).toEqual(real);
    expect(Array.from(context.calls[0]!.imag)).toEqual([0, 0.25, 0.125]);
    expect(context.calls[0]!.real).not.toBe(real);
    expect(context.calls[0]!.imag).not.toBe(imag);
    expect(context.calls[0]!.constraints).toEqual({ disableNormalization: true });
  });

  it("creates sine-only periodic waves from partial amplitudes", () => {
    const context = createMockContext();

    createPeriodicWaveFromPartials(context, {
      partials: [1, 0.5, 0.25],
    });

    expect(Array.from(context.calls[0]!.real)).toEqual([0, 0, 0, 0]);
    expect(Array.from(context.calls[0]!.imag)).toEqual([0, 1, 0.5, 0.25]);
  });

  it("unwraps audio context facades", () => {
    const native = createMockContext();
    const facade = createMockFacade(asNative<AudioContext>(native));

    createPeriodicWaveFromPartials(facade, { partials: [1] });

    expect(native.calls).toHaveLength(1);
  });

  it("applies a periodic wave to an oscillator", () => {
    const wave = asNative<PeriodicWave>({});
    const setPeriodicWave = vi.fn<(periodicWave: PeriodicWave) => void>();

    const oscillator = asNative<OscillatorNode>({
      setPeriodicWave,
    });

    const result = applyPeriodicWave(oscillator, wave);

    expect(result).toBe(oscillator);
    expect(setPeriodicWave).toHaveBeenCalledWith(wave);
  });

  it("rejects invalid coefficient data and unsupported contexts", () => {
    const context = createMockContext();

    expect(() => createPeriodicWave(context, { imag: [0], real: [] })).toThrow(RangeError);
    expect(() => createPeriodicWave(context, { imag: [0], real: [0, 1] })).toThrow(RangeError);
    expect(() => createPeriodicWaveFromPartials(context, { partials: [] })).toThrow(RangeError);
    expect(() =>
      createPeriodicWave(
        asNative<BaseAudioContext>({
          currentTime: 0,
          destination: {},
          state: "running",
        }),
        { imag: [0], real: [0] },
      ),
    ).toThrow(AudioUnsupportedError);
  });
});
