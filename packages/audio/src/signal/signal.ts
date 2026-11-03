import { isNumber } from "@temelj/value";

import { Blueprint, BlueprintParam, type BlueprintParams } from "../graph/blueprint.ts";
import { requireNonNegative, requirePositiveInteger } from "../validation.ts";

export const SIGNAL_OPERATIONS = [
  "abs",
  "add",
  "audioToGain",
  "constant",
  "gainToAudio",
  "greaterThan",
  "greaterThanZero",
  "multiply",
  "negate",
  "pow",
  "scale",
  "scaleExp",
  "subtract",
  "zero",
] as const;

export type SignalOperation = (typeof SIGNAL_OPERATIONS)[number];

export type SignalOperand = number | Blueprint;

/**
 * Native node options for a signal. The option shape selects the backing node:
 * `offset` → `ConstantSourceNode`, `curve` → `WaveShaperNode`, `gain` → `GainNode`.
 */
export type SignalNodeOptions =
  | { readonly offset: number }
  | { readonly gain: number }
  | { readonly curve: Float32Array };

export type SignalParams = BlueprintParams & {
  readonly offset?: BlueprintParam;
  readonly gain?: BlueprintParam;
};

export type SignalCurveOptions = {
  /**
   * Number of samples in the shaping curve.
   */
  readonly samples?: number;
};

const DEFAULT_CURVE_SAMPLES = 8_192;

const DEFAULT_THRESHOLD_SAMPLES = 127;

const ABS_SILENCE_THRESHOLD = 0.001;

const GREATER_THAN_ZERO_SCALE = 10_000;

/**
 * Audio-rate value computed from other signals and constants.
 *
 * `sources` records the operands so graph inspection and presets can describe the operation.
 */
export class SignalBlueprint extends Blueprint<"signal", SignalNodeOptions, SignalParams> {
  readonly operation: SignalOperation;
  readonly sources: readonly SignalOperand[];

  constructor(
    operation: SignalOperation,
    sources: readonly SignalOperand[],
    options: SignalNodeOptions,
  ) {
    super("signal", options, getSignalParamKeys(options));
    this.operation = operation;
    this.sources = [...sources];
  }
}

function getSignalParamKeys(options: SignalNodeOptions): readonly string[] {
  if ("offset" in options) {
    return ["offset"];
  }

  if ("gain" in options) {
    return ["gain"];
  }

  return [];
}

function constant(operation: SignalOperation, value: number, sources: readonly SignalOperand[]) {
  return new SignalBlueprint(operation, sources, { offset: value });
}

function toBlueprint(operand: SignalOperand): Blueprint {
  return isNumber(operand) ? signal(operand) : operand;
}

function sum(
  operation: SignalOperation,
  sources: readonly SignalOperand[],
  terms: readonly SignalOperand[],
): SignalBlueprint {
  const output = new SignalBlueprint(operation, sources, { gain: 1 });

  for (const term of terms) {
    toBlueprint(term).connect(output);
  }

  return output;
}

function product(
  operation: SignalOperation,
  sources: readonly SignalOperand[],
  input: Blueprint,
  factor: SignalOperand,
): SignalBlueprint {
  if (isNumber(factor)) {
    const output = new SignalBlueprint(operation, sources, { gain: factor });
    input.connect(output);

    return output;
  }

  const output = new SignalBlueprint(operation, sources, { gain: 0 });
  input.connect(output);
  const gainParam = output.params.gain;

  if (gainParam !== undefined) {
    factor.connect(gainParam);
  }

  return output;
}

function curveSignal(
  operation: SignalOperation,
  sources: readonly SignalOperand[],
  input: Blueprint,
  curve: Float32Array,
): SignalBlueprint {
  const output = new SignalBlueprint(operation, sources, { curve });
  input.connect(output);

  return output;
}

/**
 * Creates a constant signal blueprint with `value`.
 */
export function signal(value = 0): SignalBlueprint {
  return constant("constant", value, [value]);
}

/**
 * Creates a signal blueprint that outputs 0.
 */
export function zero(): SignalBlueprint {
  return constant("zero", 0, []);
}

/**
 * Creates a signal blueprint that outputs `left + right`. Numbers become constant signals.
 */
export function add(left: SignalOperand, right: SignalOperand): SignalBlueprint {
  if (isNumber(left) && isNumber(right)) {
    return signal(left + right);
  }

  return sum("add", [left, right], [left, right]);
}

/**
 * Creates a signal blueprint that outputs `left - right`. Numbers become constant signals.
 */
export function subtract(left: SignalOperand, right: SignalOperand): SignalBlueprint {
  if (isNumber(left) && isNumber(right)) {
    return signal(left - right);
  }

  return sum("subtract", [left, right], [left, isNumber(right) ? -right : negate(right)]);
}

/**
 * Creates a signal blueprint that outputs `left × right`. A number operand becomes the gain applied
 * to the other operand; two numbers fold into a constant signal.
 */
export function multiply(left: SignalOperand, right: SignalOperand): SignalBlueprint {
  if (isNumber(left) && isNumber(right)) {
    return signal(left * right);
  }

  return isNumber(left)
    ? product("multiply", [left, right], toBlueprint(right), left)
    : product("multiply", [left, right], left, right);
}

/**
 * Creates a signal blueprint that outputs `-input`.
 */
export function negate(input: SignalOperand): SignalBlueprint {
  if (isNumber(input)) {
    return signal(-input);
  }

  return product("negate", [input], input, -1);
}

/**
 * Maps an input in [0, 1] to [min, max].
 */
export function scale(input: SignalOperand, min: number, max: number): SignalBlueprint {
  if (isNumber(input)) {
    return signal(min + input * (max - min));
  }

  return sum(
    "scale",
    [input, min, max],
    [product("multiply", [input, max - min], input, max - min), min],
  );
}

/**
 * Maps an input in [0, 1] to [min, max] along the power curve `input ^ exponent`.
 *
 * @throws {AudioRangeError} When `exponent` is negative.
 */
export function scaleExp(
  input: SignalOperand,
  min: number,
  max: number,
  exponent = 1,
): SignalBlueprint {
  requireNonNegative(exponent, "exponent");

  if (isNumber(input)) {
    return signal(min + Math.abs(input) ** exponent * (max - min));
  }

  const curved = pow(input, exponent);

  return sum(
    "scaleExp",
    [input, min, max, exponent],
    [product("multiply", [curved, max - min], curved, max - min), min],
  );
}

/**
 * Maps an audio-range input in [-1, 1] to a gain-range output in [0, 1].
 */
export function audioToGain(input: SignalOperand): SignalBlueprint {
  if (isNumber(input)) {
    return signal((input + 1) / 2);
  }

  return sum("audioToGain", [input], [product("multiply", [input, 0.5], input, 0.5), 0.5]);
}

/**
 * Maps a gain-range input in [0, 1] to an audio-range output in [-1, 1].
 */
export function gainToAudio(input: SignalOperand): SignalBlueprint {
  if (isNumber(input)) {
    return signal(input * 2 - 1);
  }

  return sum("gainToAudio", [input], [product("multiply", [input, 2], input, 2), -1]);
}

/**
 * Creates a signal blueprint that outputs `|input|` through a wave-shaper curve, so the input must
 * stay within -1 to 1.
 */
export function abs(input: SignalOperand, options: SignalCurveOptions = {}): SignalBlueprint {
  if (isNumber(input)) {
    return signal(absoluteValue(input));
  }

  return curveSignal(
    "abs",
    [input],
    input,
    createAbsCurve(options.samples ?? DEFAULT_CURVE_SAMPLES),
  );
}

/**
 * Creates a signal blueprint that outputs `|input| ^ exponent` through a wave-shaper curve, so the
 * input must stay within -1 to 1.
 *
 * @throws {AudioRangeError} When `exponent` is negative.
 */
export function pow(
  input: SignalOperand,
  exponent = 1,
  options: SignalCurveOptions = {},
): SignalBlueprint {
  requireNonNegative(exponent, "exponent");

  if (isNumber(input)) {
    return signal(Math.abs(input) ** exponent);
  }

  return curveSignal(
    "pow",
    [input, exponent],
    input,
    createPowCurve(exponent, options.samples ?? DEFAULT_CURVE_SAMPLES),
  );
}

/**
 * Outputs 1 where the input is above zero and 0 elsewhere.
 */
export function greaterThanZero(
  input: SignalOperand,
  options: SignalCurveOptions = {},
): SignalBlueprint {
  if (isNumber(input)) {
    return signal(input > 0 ? 1 : 0);
  }

  return curveSignal(
    "greaterThanZero",
    [input],
    product("multiply", [input, GREATER_THAN_ZERO_SCALE], input, GREATER_THAN_ZERO_SCALE),
    createGreaterThanZeroCurve(options.samples ?? DEFAULT_THRESHOLD_SAMPLES),
  );
}

/**
 * Outputs 1 where the input is above `comparator` and 0 elsewhere.
 */
export function greaterThan(
  input: SignalOperand,
  comparator = 0,
  options: SignalCurveOptions = {},
): SignalBlueprint {
  if (isNumber(input)) {
    return signal(input > comparator ? 1 : 0);
  }

  const difference = subtract(input, comparator);

  return curveSignal(
    "greaterThan",
    [input, comparator],
    product("multiply", [difference, GREATER_THAN_ZERO_SCALE], difference, GREATER_THAN_ZERO_SCALE),
    createGreaterThanZeroCurve(options.samples ?? DEFAULT_THRESHOLD_SAMPLES),
  );
}

function absoluteValue(value: number): number {
  return Math.abs(value) < ABS_SILENCE_THRESHOLD ? 0 : Math.abs(value);
}

/**
 * Samples `map` over the wave-shaper input domain [-1, 1].
 */
function createSignalCurve(samples: number, map: (value: number) => number): Float32Array {
  const length = Math.max(2, requirePositiveInteger(samples, "samples"));

  return Float32Array.from({ length }, (_, index) => map((index * 2) / (length - 1) - 1));
}

/**
 * Creates the wave-shaper curve used by `abs()`.
 */
export function createAbsCurve(samples: number = DEFAULT_CURVE_SAMPLES): Float32Array {
  return createSignalCurve(samples, absoluteValue);
}

/**
 * Creates the wave-shaper curve used by `pow()`.
 *
 * @throws {AudioRangeError} When `exponent` is negative.
 */
export function createPowCurve(
  exponent = 1,
  samples: number = DEFAULT_CURVE_SAMPLES,
): Float32Array {
  requireNonNegative(exponent, "exponent");

  return createSignalCurve(samples, (value) => Math.abs(value) ** exponent);
}

/**
 * Creates a wave-shaper curve that outputs 1 for positive inputs and 0 otherwise.
 */
export function createGreaterThanZeroCurve(
  samples: number = DEFAULT_THRESHOLD_SAMPLES,
): Float32Array {
  return createSignalCurve(samples, (value) => (value > 0 ? 1 : 0));
}
