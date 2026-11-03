import { AudioRangeError } from "./errors.ts";

/*
 * Invalid-input policy for the whole package:
 *
 * - Caller-supplied numbers that are not finite, or violate a documented sign or integer
 *   constraint, throw `AudioRangeError`.
 * - Values with a documented bounded range (gains, wet mixes, normal ranges) are clamped into
 *   that range after the finiteness check.
 */

export function requireFinite(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    AudioRangeError.notFinite(name, value);
  }

  return value;
}

export function requirePositive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    AudioRangeError.notPositive(name, value);
  }

  return value;
}

export function requireNonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    AudioRangeError.negative(name, value);
  }

  return value;
}

export function requireInteger(value: number, name: string): number {
  if (!Number.isInteger(value)) {
    AudioRangeError.notInteger(name, value);
  }

  return value;
}

export function requirePositiveInteger(value: number, name: string): number {
  return requireInteger(requirePositive(value, name), name);
}

export function requireNonNegativeInteger(value: number, name: string): number {
  return requireInteger(requireNonNegative(value, name), name);
}

export function requireInRange(value: number, min: number, max: number, name: string): number {
  if (!Number.isFinite(value) || value < min || value > max) {
    AudioRangeError.outOfRange(name, value, min, max);
  }

  return value;
}

export function clampRange(value: number, min: number, max: number, name: string): number {
  return Math.min(max, Math.max(min, requireFinite(value, name)));
}

export function clampNormal(value: number, name: string): number {
  return clampRange(value, 0, 1, name);
}

/**
 * Floors a count that must be at least 1, such as a channel count.
 */
export function floorPositive(value: number, name: string): number {
  return Math.floor(requireInRange(value, 1, Number.POSITIVE_INFINITY, name));
}

/**
 * Floors a non-negative quantity, such as a tick count.
 */
export function floorNonNegative(value: number, name: string): number {
  return Math.floor(requireNonNegative(value, name));
}

/**
 * Largest distance from a whole frame that still counts as that frame.
 */
const FRAME_TOLERANCE = 1e-6;

/**
 * Returns `frames` rounded to the nearest integer when it is within floating-point error of one,
 * otherwise unchanged. A frame count computed as `seconds * sampleRate` can land slightly off
 * (`0.07 * 44_100` is `3087.0000000000005`, `0.35 * 44_100` is `15434.999999999998`), which would
 * otherwise fail an integer check or floor to one frame short.
 */
export function snapToFrame(frames: number): number {
  const rounded = Math.round(frames);

  return Math.abs(frames - rounded) <= FRAME_TOLERANCE ? rounded : frames;
}
