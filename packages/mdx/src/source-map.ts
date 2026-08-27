import { encodeBase64 } from "@temelj/string";

import type { SourceFile, SourceSpan } from "./model.ts";

export interface SourceMap {
  readonly file?: string;
  readonly mappings: string;
  readonly names: readonly string[];
  readonly sources: readonly string[];
  readonly sourcesContent: readonly string[];
  readonly version: 3;
}

interface MappingPoint {
  readonly generatedColumn: number;
  readonly generatedLine: number;
  readonly originalColumn: number;
  readonly originalLine: number;
}

/** Private generated-text builder that records original MDX locations. */
export class CodeWriter {
  private readonly chunks: string[] = [];
  private readonly points: MappingPoint[] = [];
  private column = 0;
  private line = 0;
  private size = 0;
  private sourceFile?: SourceFile;

  public constructor(sourceFile?: SourceFile) {
    this.sourceFile = sourceFile;
  }

  public get length(): number {
    return this.size;
  }

  public write(value: string, span?: SourceSpan): void {
    if (value.length === 0) {
      return;
    }

    if (span !== undefined) {
      if (this.sourceFile === undefined) {
        this.sourceFile = span.file;
      }
      if (this.sourceFile === span.file) {
        const location = span.file.location(span.start);
        this.points.push({
          generatedColumn: this.column,
          generatedLine: this.line,
          originalColumn: location.column - 1,
          originalLine: location.line - 1,
        });
      }
    }

    this.chunks.push(value);
    this.size += value.length;
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);
      if (code === 10) {
        this.line++;
        this.column = 0;
      } else {
        this.column++;
      }
    }
  }

  public toString(): string {
    return this.chunks.join("");
  }

  public sourceMap(sourceName: string, outputName?: string): SourceMap {
    const source = this.sourceFile;
    return Object.freeze({
      version: 3 as const,
      file: outputName,
      names: Object.freeze([]),
      sources: Object.freeze([sourceName]),
      sourcesContent: Object.freeze([source?.text ?? ""]),
      mappings: encodeMappings(this.points),
    });
  }
}

function encodeMappings(points: readonly MappingPoint[]): string {
  if (points.length === 0) {
    return "";
  }

  const lines: string[] = [];
  let generatedLine = 0;
  let previousOriginalColumn = 0;
  let previousOriginalLine = 0;
  let previousSource = 0;
  let index = 0;

  while (index < points.length) {
    const segments: string[] = [];
    let previousGeneratedColumn = 0;
    while (index < points.length && points[index].generatedLine === generatedLine) {
      const point = points[index];
      segments.push(
        encodeVlq(point.generatedColumn - previousGeneratedColumn) +
          encodeVlq(0 - previousSource) +
          encodeVlq(point.originalLine - previousOriginalLine) +
          encodeVlq(point.originalColumn - previousOriginalColumn),
      );
      previousGeneratedColumn = point.generatedColumn;
      previousSource = 0;
      previousOriginalLine = point.originalLine;
      previousOriginalColumn = point.originalColumn;
      index++;
    }
    lines.push(segments.join(","));
    generatedLine++;
  }

  return lines.join(";");
}

function encodeVlq(value: number): string {
  let encoded = "";
  let remaining = value < 0 ? (-value << 1) | 1 : value << 1;
  do {
    let digit = remaining & 31;
    remaining >>>= 5;
    if (remaining > 0) {
      digit |= 32;
    }
    encoded += encodeBase64(Uint8Array.of(digit << 2))[0];
  } while (remaining > 0);
  return encoded;
}
