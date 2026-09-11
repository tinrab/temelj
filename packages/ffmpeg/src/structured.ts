import type {
  MetadataSpecifier,
  OutputMetadataOptions as GeneratedOutputMetadataOptions,
  OutputOptions as GeneratedOutputOptions,
} from "./generated/options.ts";
import type { OutputMetadataOptions, OutputOptions } from "./types.ts";

import { FFmpegDefinitionError } from "./errors.ts";

export type OneOrMany<T> = T | readonly T[];

export interface UnsafeValue<TValue extends string = string> {
  raw: TValue;
}

export interface MetadataAssignment {
  key: string;
  value: string | number | boolean;
}

export interface MetadataMap {
  inputFileIndex: number;
  inputScope?: MetadataSpecifier;
  outputScope?: MetadataSpecifier;
}

export interface ProgramDefinition {
  title?: string;
  programNum?: number;
  streams: readonly (number | string)[];
}

export interface StreamGroupDefinition {
  inputFileId?: number;
  inputGroupId?: number;
  type?: string;
  id?: number | string;
  streams?: readonly (number | string)[];
  streamGroups?: readonly (number | string)[];
  options?: Record<string, string | number | boolean>;
}

export interface StreamIdDefinition {
  outputStreamIndex: number;
  newValue: number | string;
}

export type DispositionDefinition =
  | { clear: true }
  | { set: readonly [string, ...string[]] }
  | {
      add?: readonly string[];
      remove?: readonly string[];
    };

export type ForceKeyFramesDefinition =
  | { mode: "times"; times: readonly [string | number, ...(string | number)[]] }
  | { mode: "expr"; expr: string }
  | { mode: "source" }
  | { mode: "scd_metadata" };

export type MetadataValue = OneOrMany<MetadataAssignment | UnsafeValue>;

export type MetadataMapValue = OneOrMany<MetadataMap | UnsafeValue>;

export type ProgramValue = OneOrMany<ProgramDefinition | UnsafeValue>;

export type StreamGroupValue = OneOrMany<StreamGroupDefinition | UnsafeValue>;

export type StreamIdValue = OneOrMany<StreamIdDefinition | UnsafeValue>;

export type DispositionValue = OneOrMany<DispositionDefinition | UnsafeValue>;

export type ForceKeyFramesValue = ForceKeyFramesDefinition | UnsafeValue;

type StructuredDefinition =
  | MetadataAssignment
  | MetadataMap
  | ProgramDefinition
  | StreamGroupDefinition
  | StreamIdDefinition
  | DispositionDefinition
  | ForceKeyFramesDefinition;

function isUnsafeValue(value: StructuredDefinition | UnsafeValue): value is UnsafeValue {
  return "raw" in value;
}

function isMany<T>(value: OneOrMany<T>): value is readonly T[] {
  return Array.isArray(value);
}

function ensureNonEmpty(value: string, label: string): string {
  if (value.length === 0) {
    FFmpegDefinitionError.nonEmpty(label);
  }

  return value;
}

function toArray<T>(value: OneOrMany<T>): readonly T[] {
  return isMany(value) ? value : [value];
}

function serializeOneOrMany<T extends StructuredDefinition>(
  value: OneOrMany<T | UnsafeValue> | undefined,
  serialize: (item: T) => string,
): string | string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const serialized = toArray(value).map((item) =>
    isUnsafeValue(item) ? item.raw : serialize(item),
  );

  return serialized.length === 1 ? serialized[0] : serialized;
}

export function unsafe<TValue extends string>(raw: TValue): UnsafeValue<TValue> {
  return { raw };
}

export function serializeMetadataAssignments(
  value: MetadataValue | undefined,
): string | string[] | undefined {
  return serializeOneOrMany(
    value,
    (item) => `${ensureNonEmpty(item.key, "Metadata key")}=${String(item.value)}`,
  );
}

export function serializeMetadataMaps(
  value: MetadataMapValue | undefined,
): string | string[] | undefined {
  return serializeOneOrMany(value, (item) => {
    const parts = [String(item.inputFileIndex)];

    if (item.inputScope) {
      parts.push(item.inputScope);
    }

    const source = parts.join(":");

    return item.outputScope ? `${source}:${item.outputScope}` : source;
  });
}

export function serializeProgramDefinitions(
  value: ProgramValue | undefined,
): string | string[] | undefined {
  return serializeOneOrMany(value, (item) => {
    if (item.streams.length === 0) {
      FFmpegDefinitionError.programStreamsRequired();
    }

    const parts: string[] = [];

    if (item.title !== undefined) parts.push(`title=${item.title}`);

    if (item.programNum !== undefined) parts.push(`program_num=${item.programNum}`);

    for (const stream of item.streams) {
      parts.push(`st=${stream}`);
    }

    return parts.join(":");
  });
}

export function serializeStreamGroupDefinitions(
  value: StreamGroupValue | undefined,
): string | string[] | undefined {
  return serializeOneOrMany(value, (item) => {
    const parts: string[] = [];

    if (item.inputFileId !== undefined || item.inputGroupId !== undefined) {
      if (item.inputFileId === undefined || item.inputGroupId === undefined) {
        FFmpegDefinitionError.streamGroupInputMappingIncomplete();
      }

      parts.push(`map=${item.inputFileId}=${item.inputGroupId}`);
    }

    if (item.type !== undefined) {
      parts.push(`type=${item.type}`);
    }

    if (item.id !== undefined) {
      parts.push(`id=${item.id}`);
    }

    for (const stream of item.streams ?? []) {
      parts.push(`st=${stream}`);
    }

    for (const streamGroup of item.streamGroups ?? []) {
      parts.push(`stg=${streamGroup}`);
    }

    for (const [key, raw] of Object.entries(item.options ?? {})) {
      parts.push(`${key}=${String(raw)}`);
    }

    return parts.join(":");
  });
}

export function serializeStreamIds(
  value: StreamIdValue | undefined,
): string | string[] | undefined {
  return serializeOneOrMany(value, (item) => `${item.outputStreamIndex}:${item.newValue}`);
}

export function serializeDispositions(
  value: DispositionValue | undefined,
): string | string[] | undefined {
  return serializeOneOrMany(value, (item) => {
    if ("clear" in item) {
      return "0";
    }

    if ("set" in item) {
      return item.set.join("+");
    }

    const parts = [
      ...(item.add ?? []).map((flag: string) => `+${flag}`),
      ...(item.remove ?? []).map((flag: string) => `-${flag}`),
    ];

    if (parts.length === 0) {
      FFmpegDefinitionError.dispositionDefinitionEmpty();
    }

    return parts.join("");
  });
}

export function serializeForceKeyFrames(
  value: ForceKeyFramesValue | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (isUnsafeValue(value)) {
    return value.raw;
  }

  switch (value.mode) {
    case "times":
      return value.times.map(String).join(",");
    case "expr":
      return `expr:${value.expr}`;
    case "source":
      return "source";
    case "scd_metadata":
      return "scd_metadata";
  }
}

export function normalizeOutputMetadataOptions(
  options: OutputMetadataOptions,
): GeneratedOutputMetadataOptions {
  return {
    ...options,
    metadata: serializeMetadataAssignments(options.metadata),
    mapMetadata: serializeMetadataMaps(options.mapMetadata),
  };
}

export function normalizeOutputOptions(options: OutputOptions): GeneratedOutputOptions {
  const metadataScopes =
    options.metadataScopes === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(options.metadataScopes).flatMap(([scope, scopeOptions]) =>
            scopeOptions === undefined
              ? []
              : [[scope, normalizeOutputMetadataOptions(scopeOptions)]],
          ),
        );

  return {
    ...options,
    metadata: serializeMetadataAssignments(options.metadata),
    mapMetadata: serializeMetadataMaps(options.mapMetadata),
    disposition: serializeDispositions(options.disposition),
    forceKeyFrames: serializeForceKeyFrames(options.forceKeyFrames),
    program: serializeProgramDefinitions(options.program),
    streamGroup: serializeStreamGroupDefinitions(options.streamGroup),
    streamid: serializeStreamIds(options.streamid),
    metadataScopes,
  };
}
