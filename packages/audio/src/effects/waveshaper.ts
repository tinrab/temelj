/* oxlint-disable anti-slop/no-shape-in-symbol-names -- `WaveShaper` is the Web Audio API name (`WaveShaperNode`, `BaseAudioContext.createWaveShaper()`). */
import type { AudioContextLike } from "../context/context.ts";

import { createWaveShaperNode, requireOverSampleType } from "../native.ts";
import { AudioNodeUnit } from "../unit.ts";

export type DistortionEffectOptions = WaveShaperOptions & {
  readonly type: "distortion";
  readonly amount?: number;
  readonly samples?: number;
};

export type WaveShaperMapping = (value: number, index: number) => number;

export type WaveShaperUnitOptions = WaveShaperOptions & {
  /**
   * Builds the curve from a function of the input in [-1, 1]. Overrides `curve`.
   */
  readonly mapping?: WaveShaperMapping;
  /**
   * Curve length used with `mapping`. Defaults to 1024.
   */
  readonly length?: number;
};

export type BitCrusherEffectOptions = WaveShaperOptions & {
  readonly type: "bitCrusher";
  readonly bits?: number;
  readonly samples?: number;
};

export type ChebyshevEffectOptions = WaveShaperOptions & {
  readonly type: "chebyshev";
  readonly order?: number;
  readonly samples?: number;
};

export type SoftClipEffectOptions = WaveShaperOptions & {
  readonly type: "softClip";
  readonly drive?: number;
  readonly samples?: number;
};

/**
 * `WaveShaperNode` with a curve that can be set from data or a mapping function.
 */
export class WaveShaper extends AudioNodeUnit {
  readonly node: WaveShaperNode;

  constructor(context: AudioContextLike, options: WaveShaperUnitOptions = {}) {
    super(context);
    const { length, mapping, ...nodeOptions } = options;
    this.node = this.nodes.add(createWaveShaperNode(this.native, nodeOptions));

    if (mapping !== undefined) {
      this.setMap(mapping, length);
    }
  }

  get input(): WaveShaperNode {
    return this.node;
  }

  get output(): WaveShaperNode {
    return this.node;
  }

  get curve(): Float32Array | null {
    return this.node.curve;
  }

  get oversample(): OverSampleType {
    return this.node.oversample;
  }

  setCurve(curve: Float32Array | readonly number[] | null): void {
    this.node.curve = curve === null ? null : Float32Array.from(curve);
  }

  setMap(mapping: WaveShaperMapping, length?: number): void {
    this.node.curve = createWaveShaperMap(mapping, length);
  }

  setOversample(oversample: OverSampleType): void {
    this.node.oversample = requireOverSampleType(oversample);
  }
}

/**
 * Creates a soft-clipping curve, `(3 + amount) · x · 20° / (π + amount · |x|)` for inputs `x` from
 * -1 to 1. Higher `amount` values saturate harder; negative values count as 0.
 */
export function createDistortionCurve(amount = 50, samples = 44_100): Float32Array {
  const curve = new Float32Array(samples);
  const deg = Math.PI / 180;
  const normalizedAmount = Math.max(0, amount);

  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((3 + normalizedAmount) * x * 20 * deg) / (Math.PI + normalizedAmount * Math.abs(x));
  }

  return curve;
}

/**
 * Creates a curve of `length` points (at least 2) by calling `mapping` with each input value from
 * -1 to 1 and its index.
 */
export function createWaveShaperMap(
  mapping: (value: number, index: number) => number,
  length = 1024,
): Float32Array<ArrayBuffer> {
  const curveLength = Math.max(2, Math.floor(length));
  const curve: Float32Array<ArrayBuffer> = new Float32Array(curveLength);

  for (let i = 0; i < curveLength; i++) {
    const normalized = (i / (curveLength - 1)) * 2 - 1;
    curve[i] = mapping(normalized, i);
  }

  return curve;
}

/**
 * Creates a staircase curve that quantizes the signal to `bits` bits (at least 1).
 */
export function createBitCrusherCurve(bits = 4, samples = 44_100): Float32Array {
  const length = Math.max(2, Math.floor(samples));
  const curve = new Float32Array(length);
  const levels = 2 ** Math.max(1, Math.floor(bits));
  const step = 2 / (levels - 1);

  for (let i = 0; i < length; i++) {
    const input = (i * 2) / (length - 1) - 1;
    curve[i] = Math.round((input + 1) / step) * step - 1;
  }

  return curve;
}

/**
 * Creates the Chebyshev polynomial curve of `order`. A full-scale sine through it comes out as its
 * `order`th harmonic; quieter inputs add lower harmonics as well.
 */
export function createChebyshevCurve(order = 1, samples = 4_096): Float32Array {
  const length = Math.max(2, Math.floor(samples));
  const degree = Math.max(1, Math.floor(order));
  const curve = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    const x = (i * 2) / (length - 1) - 1;
    curve[i] = getChebyshevCoefficient(x, degree);
  }

  return curve;
}

/**
 * Creates a `tanh` soft-clipping curve. Higher `drive` values clip harder; the curve is normalized
 * so ±1 still maps to ±1.
 */
export function createSoftClipCurve(drive = 1, samples = 44_100): Float32Array {
  const length = Math.max(2, Math.floor(samples));
  const normalizedDrive = Math.max(0, Number.isFinite(drive) ? drive : 1);
  const curve = new Float32Array(length);
  const scale = Math.tanh(normalizedDrive);

  for (let i = 0; i < length; i++) {
    const x = (i * 2) / (length - 1) - 1;
    curve[i] = scale === 0 ? x : Math.tanh(x * normalizedDrive) / scale;
  }

  return curve;
}

function getChebyshevCoefficient(x: number, degree: number): number {
  if (degree === 1) {
    return x;
  }

  let previous = 1;
  let current = x;

  for (let i = 2; i <= degree; i++) {
    const next = 2 * x * current - previous;
    previous = current;
    current = next;
  }

  return current;
}
