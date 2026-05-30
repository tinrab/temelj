import type {
  MetadataSpecifier,
  OutputMetadataOptions as GeneratedOutputMetadataOptions,
  OutputOptions as GeneratedOutputOptions,
} from "./generated/options.ts";

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
  streams: Array<number | string>;
}

export interface StreamGroupDefinition {
  inputFileId?: number;
  inputGroupId?: number;
  type?: string;
  id?: number | string;
  streams?: Array<number | string>;
  streamGroups?: Array<number | string>;
  options?: Record<string, string | number | boolean>;
}

export interface StreamIdDefinition {
  outputStreamIndex: number;
  newValue: number | string;
}

export interface DispositionDefinition {
  clear?: boolean;
  set?: string[];
  add?: string[];
  remove?: string[];
}

export type ForceKeyFramesDefinition =
  | { mode: "times"; times: Array<string | number> }
  | { mode: "expr"; expr: string }
  | { mode: "source" }
  | { mode: "scd_metadata" };

export type MetadataValue = string | string[] | MetadataAssignment | MetadataAssignment[];
export type MetadataMapValue = string | string[] | MetadataMap | MetadataMap[];
export type ProgramValue = string | string[] | ProgramDefinition | ProgramDefinition[];
export type StreamGroupValue = string | string[] | StreamGroupDefinition | StreamGroupDefinition[];
export type StreamIdValue = string | string[] | StreamIdDefinition | StreamIdDefinition[];
export type DispositionValue = string | string[] | DispositionDefinition | DispositionDefinition[];
export type ForceKeyFramesValue = string | ForceKeyFramesDefinition;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function ensureNonEmpty(value: string, label: string): string {
  if (value.length === 0) {
    throw new Error(`${label} cannot be empty`);
  }
  return value;
}

export function serializeMetadataAssignments(
  value: MetadataValue | undefined,
): string | string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string" || isStringArray(value)) {
    return value as string | string[];
  }

  const items = (Array.isArray(value) ? value : [value]) as MetadataAssignment[];
  const serialized = items.map(
    (item) => `${ensureNonEmpty(item.key, "Metadata key")}=${String(item.value)}`,
  );
  return serialized.length === 1 ? serialized[0] : serialized;
}

export function serializeMetadataMaps(
  value: MetadataMapValue | undefined,
): string | string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string" || isStringArray(value)) {
    return value as string | string[];
  }

  const items = (Array.isArray(value) ? value : [value]) as MetadataMap[];
  const serialized = items.map((item) => {
    const parts = [String(item.inputFileIndex)];
    if (item.inputScope) {
      parts.push(item.inputScope);
    }
    const source = parts.join(":");
    return item.outputScope ? `${source}:${item.outputScope}` : source;
  });
  return serialized.length === 1 ? serialized[0] : serialized;
}

export function serializeProgramDefinitions(
  value: ProgramValue | undefined,
): string | string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string" || isStringArray(value)) {
    return value as string | string[];
  }

  const items = (Array.isArray(value) ? value : [value]) as ProgramDefinition[];
  const serialized = items.map((item) => {
    if (item.streams.length === 0) {
      throw new Error("Program definition must include at least one stream");
    }

    const parts: string[] = [];
    if (item.title !== undefined) parts.push(`title=${item.title}`);
    if (item.programNum !== undefined) parts.push(`program_num=${item.programNum}`);
    for (const stream of item.streams) {
      parts.push(`st=${stream}`);
    }
    return parts.join(":");
  });
  return serialized.length === 1 ? serialized[0] : serialized;
}

export function serializeStreamGroupDefinitions(
  value: StreamGroupValue | undefined,
): string | string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string" || isStringArray(value)) {
    return value as string | string[];
  }

  const items = (Array.isArray(value) ? value : [value]) as StreamGroupDefinition[];
  const serialized = items.map((item) => {
    const parts: string[] = [];

    if (item.inputFileId !== undefined || item.inputGroupId !== undefined) {
      if (item.inputFileId === undefined || item.inputGroupId === undefined) {
        throw new Error("Stream group input mapping requires both inputFileId and inputGroupId");
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
  return serialized.length === 1 ? serialized[0] : serialized;
}

export function serializeStreamIds(
  value: StreamIdValue | undefined,
): string | string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string" || isStringArray(value)) {
    return value as string | string[];
  }

  const items = (Array.isArray(value) ? value : [value]) as StreamIdDefinition[];
  const serialized = items.map((item) => `${item.outputStreamIndex}:${item.newValue}`);
  return serialized.length === 1 ? serialized[0] : serialized;
}

export function serializeDispositions(
  value: DispositionValue | undefined,
): string | string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string" || isStringArray(value)) {
    return value as string | string[];
  }

  const items = (Array.isArray(value) ? value : [value]) as DispositionDefinition[];
  const serialized = items.map((item) => {
    if (item.clear) {
      if (
        (item.set?.length ?? 0) > 0 ||
        (item.add?.length ?? 0) > 0 ||
        (item.remove?.length ?? 0) > 0
      ) {
        throw new Error("Disposition definition cannot combine clear with set/add/remove");
      }
      return "0";
    }

    if (
      (item.set?.length ?? 0) > 0 &&
      ((item.add?.length ?? 0) > 0 || (item.remove?.length ?? 0) > 0)
    ) {
      throw new Error("Disposition definition cannot combine set with add/remove");
    }

    if (item.set && item.set.length > 0) {
      return item.set.join("+");
    }

    const parts = [
      ...(item.add ?? []).map((flag: string) => `+${flag}`),
      ...(item.remove ?? []).map((flag: string) => `-${flag}`),
    ];

    if (parts.length === 0) {
      throw new Error("Disposition definition must include clear, set, add, or remove");
    }

    return parts.join("");
  });

  return serialized.length === 1 ? serialized[0] : serialized;
}

export function serializeForceKeyFrames(
  value: ForceKeyFramesValue | undefined,
): string | undefined {
  if (value === undefined || typeof value === "string") {
    return value;
  }

  switch (value.mode) {
    case "times":
      if (value.times.length === 0) {
        throw new Error("forceKeyFrames times mode requires at least one time");
      }
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
  options: GeneratedOutputMetadataOptions,
): GeneratedOutputMetadataOptions {
  return {
    ...options,
    metadata: serializeMetadataAssignments(
      options.metadata as MetadataValue | undefined,
    ) as GeneratedOutputMetadataOptions["metadata"],
    mapMetadata: serializeMetadataMaps(
      options.mapMetadata as MetadataMapValue | undefined,
    ) as GeneratedOutputMetadataOptions["mapMetadata"],
  };
}

export function normalizeOutputOptions(options: GeneratedOutputOptions): GeneratedOutputOptions {
  const metadataScopes =
    options.metadataScopes === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(options.metadataScopes)
            .filter(([, scopeOptions]) => scopeOptions !== undefined)
            .map(([scope, scopeOptions]) => [
              scope,
              normalizeOutputMetadataOptions(scopeOptions as GeneratedOutputMetadataOptions),
            ]),
        );

  return {
    ...options,
    metadata: serializeMetadataAssignments(
      options.metadata as MetadataValue | undefined,
    ) as GeneratedOutputOptions["metadata"],
    mapMetadata: serializeMetadataMaps(
      options.mapMetadata as MetadataMapValue | undefined,
    ) as GeneratedOutputOptions["mapMetadata"],
    disposition: serializeDispositions(
      options.disposition as DispositionValue | undefined,
    ) as GeneratedOutputOptions["disposition"],
    forceKeyFrames: serializeForceKeyFrames(
      options.forceKeyFrames as ForceKeyFramesValue | undefined,
    ) as GeneratedOutputOptions["forceKeyFrames"],
    program: serializeProgramDefinitions(
      options.program as ProgramValue | undefined,
    ) as GeneratedOutputOptions["program"],
    streamGroup: serializeStreamGroupDefinitions(
      options.streamGroup as StreamGroupValue | undefined,
    ) as GeneratedOutputOptions["streamGroup"],
    streamid: serializeStreamIds(
      options.streamid as StreamIdValue | undefined,
    ) as GeneratedOutputOptions["streamid"],
    metadataScopes,
  };
}
