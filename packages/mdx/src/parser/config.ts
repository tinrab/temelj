import { ConfigurationError } from "../errors.ts";

export interface ParserLimits {
  readonly maximumNestingDepth?: number;
  readonly maximumNodes?: number;
  readonly maximumSourceLength?: number;
}

export type ParserLimit = keyof Required<ParserLimits> | "maximumPendingBlockLength";

export interface ResolvedParserLimits {
  readonly maximumNestingDepth: number;
  readonly maximumNodes: number;
  readonly maximumSourceLength: number;
}

export const defaultParserLimits: ResolvedParserLimits = Object.freeze({
  maximumNestingDepth: 1024,
  maximumNodes: 1_000_000,
  maximumSourceLength: 16 * 1024 * 1024,
});

export function resolveParserLimits(options: ParserLimits = {}): ResolvedParserLimits {
  const limits: ResolvedParserLimits = {
    maximumNestingDepth: options.maximumNestingDepth ?? defaultParserLimits.maximumNestingDepth,
    maximumNodes: options.maximumNodes ?? defaultParserLimits.maximumNodes,
    maximumSourceLength: options.maximumSourceLength ?? defaultParserLimits.maximumSourceLength,
  };
  validateParserLimit("maximumNestingDepth", limits.maximumNestingDepth, 1);
  validateParserLimit("maximumNodes", limits.maximumNodes, 1);
  validateParserLimit("maximumSourceLength", limits.maximumSourceLength, 0);
  return limits;
}

function validateParserLimit(option: string, value: number, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    ConfigurationError.invalidParserLimit(option, value, minimum);
  }
}
