import { stripQuery } from "./source.ts";

export interface GeneratedSourceMapOptions {
  readonly id: string;
  readonly originalCode: string;
  readonly generatedCode: string;
  readonly generatedSource: string;
  readonly sourceText: string;
}

export function createGeneratedSourceMap(options: GeneratedSourceMapOptions): unknown {
  return {
    version: 3,
    file: stripQuery(options.id),
    sources: [stripQuery(options.id)],
    sourcesContent: [options.originalCode],
    names: [],
    mappings: createWorkflowTransformMappings(options),
  };
}

function createWorkflowTransformMappings(options: GeneratedSourceMapOptions): string {
  const generatedLines = options.generatedCode.split("\n");
  const sourceStart =
    options.sourceText === "" ? -1 : options.generatedSource.indexOf(options.sourceText);
  const generatedStart =
    options.sourceText === "" ? -1 : options.generatedCode.indexOf(options.sourceText);
  if (sourceStart < 0 || generatedStart < 0) {
    return generatedLines.map(() => "").join(";");
  }

  const sourceStartLine = lineIndexAt(options.generatedSource, sourceStart);
  const generatedStartLine = lineIndexAt(options.generatedCode, generatedStart);
  const sourceLineCount = options.sourceText.split("\n").length;
  let previousSourceLine = 0;

  return generatedLines
    .map((_line, generatedLine) => {
      if (
        generatedLine < generatedStartLine ||
        generatedLine >= generatedStartLine + sourceLineCount
      ) {
        return "";
      }
      const sourceLine = sourceStartLine + generatedLine - generatedStartLine;
      const segment = [
        encodeSourceMapVlq(0),
        encodeSourceMapVlq(0),
        encodeSourceMapVlq(sourceLine - previousSourceLine),
        encodeSourceMapVlq(0),
      ].join("");
      previousSourceLine = sourceLine;
      return segment;
    })
    .join(";");
}

function lineIndexAt(text: string, offset: number): number {
  let line = 0;
  for (let index = 0; index < offset; index++) {
    if (text[index] === "\n") {
      line++;
    }
  }
  return line;
}

const SOURCE_MAP_BASE64_DIGITS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encodeSourceMapVlq(value: number): string {
  let vlq = value < 0 ? (-value << 1) + 1 : value << 1;
  let result = "";
  do {
    let digit = vlq & 31;
    vlq >>>= 5;
    if (vlq > 0) {
      digit |= 32;
    }
    result += SOURCE_MAP_BASE64_DIGITS[digit]!;
  } while (vlq > 0);
  return result;
}
