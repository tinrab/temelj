import type { FilterGraphStream } from "./filter-graph.ts";
import type { StreamType } from "./types.ts";

export type MapStreamType = StreamType;

export interface InputMapSpecifier {
  fileIndex: number;
  streamType?: MapStreamType;
  streamIndex?: number;
  viewSpecifier?: string;
  optional?: boolean;
  disabled?: boolean;
}

export type MapTarget = InputMapSpecifier | string;

export interface StreamMetadataTarget {
  streamType: Exclude<MapStreamType, "V">;
  streamIndex: number;
}

function normalizeLabel(label: string): string {
  return label.startsWith("[") ? label : `[${label}]`;
}

export function serializeInputMap(specifier: InputMapSpecifier): string {
  let value = String(specifier.fileIndex);

  if (specifier.streamType !== undefined) {
    value += `:${specifier.streamType}`;
  }

  if (specifier.streamIndex !== undefined) {
    if (specifier.streamType === undefined) {
      value += `:${specifier.streamIndex}`;
    } else {
      value += `:${specifier.streamIndex}`;
    }
  }

  if (specifier.viewSpecifier !== undefined) {
    value += `:${specifier.viewSpecifier}`;
  }

  if (specifier.optional) {
    value += "?";
  }

  if (specifier.disabled) {
    value = `-${value}`;
  }

  return value;
}

export function mapInputStream(
  fileIndex: number,
  streamType?: MapStreamType,
  streamIndex?: number,
): string {
  return serializeInputMap({ fileIndex, streamType, streamIndex });
}

export function mapAllStreams(fileIndex: number): string {
  return serializeInputMap({ fileIndex });
}

export function mapLabel(label: FilterGraphStream | string): string {
  const raw = typeof label === "string" ? label : label.label;
  return normalizeLabel(raw);
}

export function disableMap(target: InputMapSpecifier | string): string {
  if (typeof target === "string") {
    return target.startsWith("-") ? target : `-${target}`;
  }

  return serializeInputMap({ ...target, disabled: true });
}

export function streamMetadataKey(target: StreamMetadataTarget, _key: string): string {
  return `-metadata:s:${target.streamType}:${target.streamIndex}`;
}

export function streamDispositionKey(target: StreamMetadataTarget): string {
  return `-disposition:${target.streamType}:${target.streamIndex}`;
}
