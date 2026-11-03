import type { Blueprint, PlayContext } from "@temelj/audio";

import * as audio from "@temelj/audio";
import { transform } from "sucrase";

/**
 * What a playground program returns: the last blueprint of its effect chain, or that blueprint
 * together with a hook that runs when playback starts.
 */
export type ProgramResult =
  | Blueprint
  | {
      readonly output: Blueprint;
      readonly play?: (context: PlayContext) => void;
    };

export type Program = (input: Blueprint) => ProgramResult;

export class ProgramError extends Error {
  readonly phase: "compile" | "run";

  constructor(phase: "compile" | "run", message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProgramError";
    this.phase = phase;
  }
}

const MODULES: ReadonlyMap<string, typeof audio> = new Map([["@temelj/audio", audio]]);

/**
 * The CommonJS module object the compiled program writes its exports to.
 */
type ProgramModule = {
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- Exports of untyped user code; the default export is checked below.
  readonly exports: Record<string, unknown>;
};

/**
 * Compiles TypeScript source into a playground program. Types are stripped (not checked) and
 * `import` statements resolve to the modules the playground provides.
 */
export function compileProgram(source: string): Program {
  let code: string;

  try {
    code = transform(source, {
      filePath: "playground.ts",
      production: true,
      transforms: ["typescript", "imports"],
    }).code;
  } catch (error) {
    throw new ProgramError("compile", errorMessage(error), { cause: error });
  }

  const module: ProgramModule = { exports: {} };

  const require = (name: string): typeof audio => {
    const resolved = MODULES.get(name);

    if (resolved === undefined) {
      throw new ProgramError("compile", `cannot import "${name}"; only @temelj/audio is available`);
    }

    return resolved;
  };

  try {
    // oxlint-disable-next-line typescript/no-implied-eval -- Running user code is the point of the playground; it only sees @temelj/audio.
    new Function("require", "module", "exports", code)(require, module, module.exports);
  } catch (error) {
    throw new ProgramError("run", errorMessage(error), { cause: error });
  }

  const program = module.exports.default;

  if (!(program instanceof Function)) {
    throw new ProgramError(
      "compile",
      "export a default function that takes the input blueprint and returns a blueprint",
    );
  }

  // SAFETY: `readProgramResult()` validates the value before anything uses it.
  return (input) => program(input) as ProgramResult;
}

/**
 * Normalizes a program's return value and checks that it is a blueprint.
 */
export function readProgramResult(result: ProgramResult): {
  readonly output: Blueprint;
  readonly play?: (context: PlayContext) => void;
} {
  const resolved = result instanceof audio.Blueprint ? { output: result } : result;

  if (!(resolved?.output instanceof audio.Blueprint)) {
    throw new ProgramError(
      "run",
      "the default export must return a blueprint, or { output: blueprint, play?(context) }",
    );
  }

  return resolved;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Formats whatever a caught exception holds.
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
