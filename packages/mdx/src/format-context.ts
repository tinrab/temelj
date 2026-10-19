import type { FormatConstruct, FormatSafeInfo, FormatUnsafePattern } from "./format-safe.ts";
import type { FormatTrackInfo } from "./format-track.ts";
import type { MdxNode } from "./model.ts";
import type { ResolvedSyntaxOptions, SyntaxOptions } from "./syntax-options.ts";

export interface FormatInfo extends FormatTrackInfo {
  readonly after: string;
  readonly before: string;
}

export const rootInfo: FormatInfo = {
  after: "\n",
  before: "\n",
  lineShift: 0,
  now: { line: 1, column: 1 },
};

export interface FormatOptions {
  readonly bullet?: "*" | "+" | "-";
  readonly bulletOrdered?: "." | ")";
  readonly closeAtx?: boolean;
  readonly emphasis?: "*" | "_";
  readonly fence?: "`" | "~";
  readonly footnoteFirstLineBlank?: boolean;
  readonly incrementListMarker?: boolean;
  readonly listItemIndent?: "mixed" | "one" | "tab";
  readonly quote?: '"' | "'";
  readonly rule?: "*" | "-" | "_";
  readonly ruleRepetition?: number;
  readonly ruleSpaces?: boolean;
  readonly strong?: "*" | "_";
  readonly syntax?: SyntaxOptions;
  readonly tightDefinitions?: boolean;
  readonly tableCellPadding?: boolean;
  readonly tablePipeAlign?: boolean;
  readonly tableStringLength?: (value: string) => number;
}

/** What construct formatters share: options, the construct stack, and nested formatting. */
export interface FormatContext {
  readonly options: FormatOptions;
  readonly syntax: ResolvedSyntaxOptions;
  readonly stack: readonly FormatConstruct[];
  readonly unsafe: readonly FormatUnsafePattern[];
  compilePattern(pattern: FormatUnsafePattern): RegExp;
  flow(nodes: readonly MdxNode[], info: FormatInfo, spread?: boolean): string;
  phrasing(nodes: readonly MdxNode[], info: FormatInfo): string;
  enter(construct: FormatConstruct): () => void;
  safe(value: string, info: FormatSafeInfo): string;
}

export function indentLines(
  value: string,
  map: (line: string, blank: boolean, index: number) => string,
): string {
  return value
    .split(/\r\n?|\n/gu)
    .map((line, index) => map(line, line.length === 0, index))
    .join("\n");
}

export function longestRun(value: string, marker: string): number {
  let longest = 0;
  let current = 0;

  for (const character of value) {
    current = character === marker ? current + 1 : 0;
    longest = Math.max(longest, current);
  }

  return longest;
}
