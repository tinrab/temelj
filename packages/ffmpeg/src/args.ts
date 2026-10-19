import type {
  GlobalOptions,
  InputOptions,
  OutputOptions,
  RawOptionBag,
  SerializedOptionScalar,
  SerializedOptionValue,
} from "./types.ts";

import {
  type OptionDefinition,
  type OptionKind,
  generatedInputDefs,
  generatedInputStreamDefs,
  generatedOutputDefs,
  generatedOutputMetadataDefs,
  generatedOutputStreamDefs,
  generatedGlobalDefs,
} from "./generated/serialize.ts";
import { normalizeOutputOptions } from "./structured.ts";

function isOptionArray(value: SerializedOptionValue): value is readonly SerializedOptionScalar[] {
  return Array.isArray(value);
}

function appendRawValue(args: string[], flag: string, value: SerializedOptionScalar): void {
  if (value === true || value === false) {
    if (value) {
      args.push(flag);
    }

    return;
  }

  args.push(flag, String(value));
}

function serializeRaw(args: string[], raw: RawOptionBag | undefined): void {
  if (!raw) {
    return;
  }

  for (const [flag, value] of Object.entries(raw)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (isOptionArray(value)) {
      for (const item of value) {
        appendRawValue(args, flag, item);
      }

      continue;
    }

    appendRawValue(args, flag, value);
  }
}

function appendDefinedValue(
  args: string[],
  kind: OptionKind,
  flag: string,
  value: SerializedOptionValue | undefined,
): void {
  if (value === undefined || value === null) {
    return;
  }

  if (kind === "array" && isOptionArray(value)) {
    for (const item of value) {
      args.push(flag, String(item));
    }

    return;
  }

  if (kind === "flag") {
    if (value) {
      args.push(flag);
    }

    return;
  }

  if (value !== true && value !== false && !isOptionArray(value)) {
    args.push(flag, String(value));
  }
}

function flagWithSpecifier(flag: string, specifier: string): string {
  const fixedSpecifierMatch = flag.match(/^(-[^:]+):([A-Za-z])$/);

  if (fixedSpecifierMatch) {
    const [, , fixedSpecifier] = fixedSpecifierMatch;

    if (specifier === fixedSpecifier) {
      return flag;
    }

    if (specifier.startsWith(`${fixedSpecifier}:`)) {
      return `${flag}${specifier.slice(fixedSpecifier.length)}`;
    }
  }

  return `${flag}:${specifier}`;
}

function serializeScoped<TOptions>(
  args: string[],
  bag: Partial<Record<string, TOptions>> | undefined,
  defs: readonly OptionDefinition<TOptions>[],
  getFlag: (flag: string, specifier: string) => string = (flag, specifier) =>
    `${flag}:${specifier}`,
): void {
  if (!bag) {
    return;
  }

  for (const [specifier, scoped] of Object.entries(bag)) {
    if (scoped === undefined) continue;

    for (const def of defs) {
      appendDefinedValue(args, def.kind, getFlag(def.flag, specifier), def.read(scoped));
    }
  }
}

function serializeDefined<TOptions extends { raw?: RawOptionBag }>(
  opts: TOptions,
  defs: readonly OptionDefinition<TOptions>[],
): string[] {
  const args: string[] = [];

  for (const def of defs) {
    appendDefinedValue(args, def.kind, def.flag, def.read(opts));
  }

  serializeRaw(args, opts.raw);

  return args;
}

export function serializeGlobal(opts: GlobalOptions): string[] {
  return serializeDefined(
    {
      ...opts,
      filterComplex: opts.filterComplex === undefined ? undefined : String(opts.filterComplex),
    },
    generatedGlobalDefs,
  );
}

export function serializeInput(opts: InputOptions): string[] {
  const args = serializeDefined(opts, generatedInputDefs);

  serializeScoped(args, opts.streams, generatedInputStreamDefs);

  return args;
}

export function serializeOutput(opts: OutputOptions): string[] {
  const normalized = normalizeOutputOptions(opts);

  const args = serializeDefined(normalized, generatedOutputDefs);

  serializeScoped(args, normalized.streams, generatedOutputStreamDefs, flagWithSpecifier);
  serializeScoped(args, normalized.metadataScopes, generatedOutputMetadataDefs);

  return args;
}
