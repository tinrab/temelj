import { encodeNumericCharacterReference } from "./utility.ts";

export type FormatConstruct =
  | "autolink"
  | "blockquote"
  | "codeFencedLangGraveAccent"
  | "codeFencedLangTilde"
  | "codeFencedMetaGraveAccent"
  | "codeFencedMetaTilde"
  | "definition"
  | "containerDirective"
  | "directiveLabel"
  | "destinationLiteral"
  | "destinationRaw"
  | "mathFlow"
  | "mathFlowMeta"
  | "emphasis"
  | "footnoteDefinition"
  | "footnoteReference"
  | "headingAtx"
  | "headingSetext"
  | "image"
  | "imageReference"
  | "label"
  | "link"
  | "linkReference"
  | "inlineMath"
  | "list"
  | "listItem"
  | "leafDirective"
  | "paragraph"
  | "phrasing"
  | "reference"
  | "strong"
  | "strikethrough"
  | "table"
  | "tableCell"
  | "tableRow"
  | "textDirective"
  | "titleApostrophe"
  | "titleQuote";

export interface FormatUnsafePattern {
  readonly character: string;
  readonly after?: string;
  readonly atBreak?: true;
  readonly before?: string;
  readonly inConstruct?: FormatConstruct | readonly FormatConstruct[];
  readonly notInConstruct?: FormatConstruct | readonly FormatConstruct[];
}

export interface FormatSafeInfo {
  readonly after: string;
  readonly before: string;
  readonly encode?: readonly string[];
}

export interface FormatSafetyState {
  readonly stack: readonly FormatConstruct[];
  readonly unsafe: readonly FormatUnsafePattern[];
  compilePattern(pattern: FormatUnsafePattern): RegExp;
}

const fullPhrasingSpans: readonly FormatConstruct[] = [
  "autolink",
  "destinationLiteral",
  "destinationRaw",
  "reference",
  "titleQuote",
  "titleApostrophe",
];

export const unsafePatterns: readonly FormatUnsafePattern[] = [
  { character: "\t", after: "[\\r\\n]", inConstruct: "phrasing" },
  { character: "\r", inConstruct: "tableCell" },
  { character: "\n", inConstruct: "tableCell" },
  { character: "\t", before: "[\\r\\n]", inConstruct: "phrasing" },
  { character: "\t", inConstruct: ["codeFencedLangGraveAccent", "codeFencedLangTilde"] },
  {
    character: "\r",
    inConstruct: [
      "codeFencedLangGraveAccent",
      "codeFencedLangTilde",
      "codeFencedMetaGraveAccent",
      "codeFencedMetaTilde",
      "destinationLiteral",
      "headingAtx",
    ],
  },
  {
    character: "\n",
    inConstruct: [
      "codeFencedLangGraveAccent",
      "codeFencedLangTilde",
      "codeFencedMetaGraveAccent",
      "codeFencedMetaTilde",
      "destinationLiteral",
      "headingAtx",
    ],
  },
  { character: " ", after: "[\\r\\n]", inConstruct: "phrasing" },
  { character: " ", before: "[\\r\\n]", inConstruct: "phrasing" },
  { character: " ", inConstruct: ["codeFencedLangGraveAccent", "codeFencedLangTilde"] },
  { character: "!", after: "\\[", inConstruct: "phrasing", notInConstruct: fullPhrasingSpans },
  { character: '"', inConstruct: "titleQuote" },
  { atBreak: true, character: "#" },
  { character: "#", inConstruct: "headingAtx", after: "(?:[\\r\\n]|$)" },
  { character: "&", after: "[#A-Za-z]", inConstruct: "phrasing" },
  {
    character: "@",
    before: "[+\\-.\\w]",
    after: "[\\-.\\w]",
    inConstruct: "phrasing",
    notInConstruct: ["autolink", "link", "image", "label"],
  },
  { character: "'", inConstruct: "titleApostrophe" },
  { character: "(", inConstruct: "destinationRaw" },
  { before: "\\]", character: "(", inConstruct: "phrasing", notInConstruct: fullPhrasingSpans },
  { atBreak: true, before: "\\d+", character: ")" },
  { character: ")", inConstruct: "destinationRaw" },
  {
    character: ".",
    before: "[Ww]",
    after: "[\\-.\\w]",
    inConstruct: "phrasing",
    notInConstruct: ["autolink", "link", "image", "label"],
  },
  {
    character: ":",
    before: "[ps]",
    after: "\\/",
    inConstruct: "phrasing",
    notInConstruct: ["autolink", "link", "image", "label"],
  },
  { atBreak: true, character: "*", after: "(?:[ \\t\\r\\n*])" },
  { character: "*", inConstruct: "phrasing", notInConstruct: fullPhrasingSpans },
  { atBreak: true, character: "+", after: "(?:[ \\t\\r\\n])" },
  { atBreak: true, character: "-", after: "(?:[ \\t\\r\\n-])" },
  { atBreak: true, before: "\\d+", character: ".", after: "(?:[ \\t\\r\\n]|$)" },
  { atBreak: true, character: "<", after: "[!/?A-Za-z]" },
  {
    character: "<",
    after: "[!/?A-Za-z]",
    inConstruct: "phrasing",
    notInConstruct: fullPhrasingSpans,
  },
  { character: "<", inConstruct: "destinationLiteral" },
  { atBreak: true, character: "=" },
  { atBreak: true, character: ">" },
  { character: ">", inConstruct: "destinationLiteral" },
  { atBreak: true, character: "[" },
  { character: "[", inConstruct: "phrasing", notInConstruct: fullPhrasingSpans },
  { character: "[", inConstruct: ["label", "reference"] },
  { character: "\\", after: "[\\r\\n]", inConstruct: "phrasing" },
  { character: "]", inConstruct: ["label", "reference"] },
  { atBreak: true, character: "_" },
  { character: "_", inConstruct: "phrasing", notInConstruct: fullPhrasingSpans },
  { atBreak: true, character: "`" },
  { character: "`", inConstruct: ["codeFencedLangGraveAccent", "codeFencedMetaGraveAccent"] },
  { character: "`", inConstruct: "phrasing", notInConstruct: fullPhrasingSpans },
  { atBreak: true, character: "~" },
  { character: "~", inConstruct: "phrasing", notInConstruct: fullPhrasingSpans },
  { atBreak: true, character: "|", after: "[\\t :-]" },
  { character: "|", inConstruct: "tableCell" },
  { atBreak: true, character: ":", after: "-" },
  { atBreak: true, character: "-", after: "[:|-]" },
];

export function safeSource(state: FormatSafetyState, input: string, info: FormatSafeInfo): string {
  const value = info.before + input + info.after;
  const positions: number[] = [];
  const details = new Map<number, { before: boolean; after: boolean }>();
  for (const pattern of state.unsafe) {
    if (!patternInScope(state.stack, pattern)) {
      continue;
    }
    const expression = state.compilePattern(pattern);
    expression.lastIndex = 0;
    let match = expression.exec(value);
    while (match !== null) {
      const before = pattern.before !== undefined || pattern.atBreak === true;
      const after = pattern.after !== undefined;
      const position = match.index + (before ? (match[1]?.length ?? 0) : 0);
      const existing = details.get(position);
      if (existing === undefined) {
        positions.push(position);
        details.set(position, { before, after });
      } else {
        if (existing.before && !before) {
          existing.before = false;
        }
        if (existing.after && !after) {
          existing.after = false;
        }
      }
      match = expression.exec(value);
    }
  }
  positions.sort((left, right) => left - right);

  let start = info.before.length;
  const end = value.length - info.after.length;
  const result: string[] = [];
  for (let index = 0; index < positions.length; index++) {
    const position = positions[index];
    if (position < start || position >= end) {
      continue;
    }
    const detail = details.get(position);
    if (detail === undefined) {
      continue;
    }
    const next = details.get(position + 1);
    const previous = details.get(position - 1);
    if (
      (positions[index + 1] === position + 1 &&
        detail.after &&
        next?.before === false &&
        next.after === false) ||
      (positions[index - 1] === position - 1 &&
        detail.before &&
        previous?.before === false &&
        previous.after === false)
    ) {
      continue;
    }
    if (start !== position) {
      result.push(escapeBackslashes(value.slice(start, position), "\\"));
    }
    start = position;
    const character = value.charAt(position);
    if (/[!-/:-@[-`{-~]/u.test(character) && !info.encode?.includes(character)) {
      result.push("\\");
    } else {
      result.push(encodeNumericCharacterReference(value.codePointAt(position) ?? 0));
      start += character.length;
    }
  }
  result.push(escapeBackslashes(value.slice(start, end), info.after));
  return result.join("");
}

export function compileUnsafePattern(pattern: FormatUnsafePattern): RegExp {
  const before = `${pattern.atBreak === true ? "[\\r\\n][\\t ]*" : ""}${pattern.before === undefined ? "" : `(?:${pattern.before})`}`;
  const escaped = /[|\\{}()[\]^$+*?.]/u.test(pattern.character)
    ? `\\${pattern.character}`
    : pattern.character;
  return new RegExp(
    `${before.length === 0 ? "" : `(${before})`}${escaped}${pattern.after === undefined ? "" : `(?:${pattern.after})`}`,
    "gu",
  );
}

function patternInScope(stack: readonly FormatConstruct[], pattern: FormatUnsafePattern): boolean {
  return (
    listInScope(stack, pattern.inConstruct, true) &&
    !listInScope(stack, pattern.notInConstruct, false)
  );
}

function listInScope(
  stack: readonly FormatConstruct[],
  value: FormatConstruct | readonly FormatConstruct[] | undefined,
  whenMissing: boolean,
): boolean {
  if (value === undefined) {
    return whenMissing;
  }
  return typeof value === "string"
    ? stack.includes(value)
    : value.some((construct) => stack.includes(construct));
}

function escapeBackslashes(value: string, after: string): string {
  const whole = value + after;
  const positions: number[] = [];
  const expression = /\\(?=[!-/:-@[-`{-~])/gu;
  let match = expression.exec(whole);
  while (match !== null) {
    positions.push(match.index);
    match = expression.exec(whole);
  }
  const results: string[] = [];
  let start = 0;
  for (const position of positions) {
    if (position >= value.length) {
      break;
    }
    if (start !== position) {
      results.push(value.slice(start, position));
    }
    results.push("\\");
    start = position;
  }
  results.push(value.slice(start));
  return results.join("");
}
