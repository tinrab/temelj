import { isFunction } from "@temelj/value";

import { getNativeAudioContext, type AudioContextLike } from "../context/context.ts";
import { AudioRangeError, AudioUnsupportedError } from "../errors.ts";

export type PeriodicWaveCoefficientData = Float32Array | readonly number[];

export type PeriodicWaveOptions = PeriodicWaveConstraints & {
  readonly imag: PeriodicWaveCoefficientData;
  readonly real: PeriodicWaveCoefficientData;
};

export type PeriodicWaveFromPartialsOptions = PeriodicWaveConstraints & {
  readonly partials: PeriodicWaveCoefficientData;
};

/**
 * Creates a `PeriodicWave` from cosine (`real`) and sine (`imag`) coefficients.
 *
 * @throws {AudioRangeError} When the coefficient arrays are empty or differ in length. @throws
 * {AudioUnsupportedError} When the context cannot create periodic waves.
 */
export function createPeriodicWave(
  context: AudioContextLike,
  options: PeriodicWaveOptions,
): PeriodicWave {
  // SAFETY: `createPeriodicWave` is missing on some test doubles; it is checked before use.
  const nativeContext = getNativeAudioContext(context) as BaseAudioContext & {
    createPeriodicWave?: (
      real: Float32Array,
      imag: Float32Array,
      constraints?: PeriodicWaveConstraints,
    ) => PeriodicWave;
  };

  if (!isFunction(nativeContext.createPeriodicWave)) {
    AudioUnsupportedError.missingApi("PeriodicWave");
  }

  const real = copyCoefficients(options.real, "PeriodicWave real coefficients");
  const imag = copyCoefficients(options.imag, "PeriodicWave imaginary coefficients");
  assertMatchingCoefficientLengths(real, imag);

  return nativeContext.createPeriodicWave(real, imag, {
    disableNormalization: options.disableNormalization,
  });
}

/**
 * Creates a `PeriodicWave` from harmonic amplitudes. `partials[i]` is the amplitude of harmonic `i
 * + 1`, so `partials[0]` is the fundamental.
 *
 * @throws {AudioRangeError} When `partials` is empty.
 */
export function createPeriodicWaveFromPartials(
  context: AudioContextLike,
  options: PeriodicWaveFromPartialsOptions,
): PeriodicWave {
  const partials = copyCoefficients(options.partials, "PeriodicWave partials");
  const real = new Float32Array(partials.length + 1);
  const imag = new Float32Array(partials.length + 1);

  for (let i = 0; i < partials.length; i++) {
    imag[i + 1] = partials[i]!;
  }

  return createPeriodicWave(context, {
    disableNormalization: options.disableNormalization,
    imag,
    real,
  });
}

/**
 * Sets `periodicWave` as the waveform of `oscillator` and returns the oscillator.
 */
export function applyPeriodicWave(
  oscillator: OscillatorNode,
  periodicWave: PeriodicWave,
): OscillatorNode {
  oscillator.setPeriodicWave(periodicWave);

  return oscillator;
}

function copyCoefficients(
  data: PeriodicWaveCoefficientData,
  label: string,
): Float32Array<ArrayBuffer> {
  if (data.length === 0) {
    AudioRangeError.empty(label);
  }

  return Float32Array.from(data);
}

function assertMatchingCoefficientLengths(real: Float32Array, imag: Float32Array): void {
  if (real.length !== imag.length) {
    AudioRangeError.mismatch("PeriodicWave coefficient length", real.length, imag.length);
  }
}
