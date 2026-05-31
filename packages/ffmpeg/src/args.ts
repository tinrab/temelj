import type {
  GlobalOptions,
  InputOptions,
  OutputOptions,
  RawOptionBag,
  SerializedOptionScalar,
} from "./types.ts";

import {
  generatedInputDefs,
  generatedInputStreamDefs,
  generatedOutputDefs,
  generatedOutputMetadataDefs,
  generatedOutputStreamDefs,
  generatedGlobalDefs,
} from "./generated/serialize.ts";
import { normalizeOutputOptions } from "./structured.ts";

interface Entry {
  flag: string;
  isFlag: boolean;
  isArray: boolean;
}

interface ScopedOptions {
  [key: string]: unknown;
}

function appendRawValue(args: string[], flag: string, value: SerializedOptionScalar): void {
  if (typeof value === "boolean") {
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

    if (Array.isArray(value)) {
      for (const item of value as readonly SerializedOptionScalar[]) {
        appendRawValue(args, flag, item);
      }
      continue;
    }

    appendRawValue(args, flag, value as SerializedOptionScalar);
  }
}

function appendDefinedValue(args: string[], def: Entry, flag: string, value: unknown): void {
  if (value === undefined || value === null) {
    return;
  }

  if (def.isArray && Array.isArray(value)) {
    for (const item of value) {
      args.push(flag, typeof item === "string" ? item : String(item));
    }
    return;
  }

  if (def.isFlag) {
    if (value) {
      args.push(flag);
    }
    return;
  }

  if (typeof value === "string" || typeof value === "number") {
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

function serializeScoped(
  args: string[],
  bag: Record<string, ScopedOptions> | undefined,
  defs: Record<string, Entry>,
  getFlag: (flag: string, specifier: string) => string = (flag, specifier) =>
    `${flag}:${specifier}`,
): void {
  if (!bag) {
    return;
  }

  for (const [specifier, scoped] of Object.entries(bag)) {
    for (const [key, def] of Object.entries(defs)) {
      appendDefinedValue(args, def, getFlag(def.flag, specifier), scoped[key]);
    }
  }
}

function serializeDefined(
  opts: Record<string, unknown> & { raw?: RawOptionBag },
  defs: Record<string, Entry>,
): string[] {
  const args: string[] = [];

  for (const [key, def] of Object.entries(defs)) {
    appendDefinedValue(args, def, def.flag, opts[key]);
  }

  serializeRaw(args, opts.raw);

  return args;
}

export function serializeGlobal(opts: GlobalOptions): string[] {
  return serializeDefined(
    opts as Record<string, unknown> & { raw?: RawOptionBag },
    generatedGlobalDefs,
  );
}

export function serializeInput(opts: InputOptions): string[] {
  const args = serializeDefined(
    opts as Record<string, unknown> & { raw?: RawOptionBag },
    generatedInputDefs,
  );
  serializeScoped(
    args,
    opts.streams as Record<string, ScopedOptions> | undefined,
    generatedInputStreamDefs,
  );
  return args;
}

export function serializeOutput(opts: OutputOptions): string[] {
  const normalized = normalizeOutputOptions(
    opts as unknown as import("./generated/options.ts").OutputOptions,
  );
  const args = serializeDefined(
    normalized as Record<string, unknown> & { raw?: RawOptionBag },
    generatedOutputDefs,
  );
  serializeScoped(
    args,
    normalized.streams as Record<string, ScopedOptions> | undefined,
    generatedOutputStreamDefs,
    flagWithSpecifier,
  );
  serializeScoped(
    args,
    normalized.metadataScopes as Record<string, ScopedOptions> | undefined,
    generatedOutputMetadataDefs,
  );
  return args;
}
