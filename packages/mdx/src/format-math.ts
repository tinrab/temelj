import type { FormatContext, FormatInfo } from "./format-context.ts";
import type { DisplayMathNode, InlineMathNode, MdxNode } from "./model.ts";
import type { MathFormat } from "./syntax-options.ts";

import { InputError } from "./errors.ts";
import { longestRun } from "./format-context.ts";
import { FormatTracker } from "./format-track.ts";
import { mdxChildren } from "./model.ts";

// Inline and display math.

export function formatDisplayMath(
  context: FormatContext,
  node: DisplayMathNode,
  info: FormatInfo,
): string {
  if (node.format === "tex") {
    if (node.meta !== undefined) {
      throw InputError.mathMetadataUnsupported();
    }

    if (node.value.includes("\\]")) {
      throw InputError.mathDelimiterCollision("displayMath", "\\]");
    }

    const exit = context.enter("mathFlow");
    const tracker = new FormatTracker(info);
    let value = tracker.move("\\[");
    value += tracker.move("\n");

    if (node.value.length > 0) {
      value += tracker.move(`${node.value}\n`);
    }

    value += tracker.move("\\]");
    exit();

    return value;
  }

  const sequence = "$".repeat(Math.max(2, longestRun(node.value, "$") + 1));
  const exit = context.enter("mathFlow");
  const tracker = new FormatTracker(info);
  let value = tracker.move(sequence);

  if (node.meta !== undefined && node.meta.length > 0) {
    const exitMeta = context.enter("mathFlowMeta");
    value += tracker.move(
      context.safe(node.meta, {
        after: "\n",
        before: value,
        encode: ["$"],
        ...tracker.current(),
      }),
    );
    exitMeta();
  }

  value += tracker.move("\n");

  if (node.value.length > 0) {
    value += tracker.move(`${node.value}\n`);
  }

  value += tracker.move(sequence);
  exit();

  return value;
}

export function formatInlineMath(context: FormatContext, node: InlineMathNode): string {
  if (node.format === "tex") {
    if (node.value.includes("\\)")) {
      throw InputError.mathDelimiterCollision("inlineMath", "\\)");
    }

    return `\\(${node.value}\\)`;
  }

  let value = node.value;
  let size = 1;

  while (new RegExp(`(^|[^$])${"\\$".repeat(size)}([^$]|$)`, "u").test(value)) {
    size++;
  }

  const sequence = "$".repeat(size);

  if (
    /[^ \r\n]/u.test(value) &&
    ((/^[ \r\n]/u.test(value) && /[ \r\n]$/u.test(value)) || /^\$|\$$/u.test(value))
  ) {
    value = ` ${value} `;
  }

  for (const pattern of context.unsafe) {
    if (pattern.atBreak !== true) {
      continue;
    }

    const expression = context.compilePattern(pattern);
    expression.lastIndex = 0;
    let match = expression.exec(value);

    while (match !== null) {
      let position = match.index;

      if (value.charCodeAt(position) === 10 && value.charCodeAt(position - 1) === 13) {
        position--;
      }

      value = `${value.slice(0, position)} ${value.slice(match.index + 1)}`;
      expression.lastIndex = 0;
      match = expression.exec(value);
    }
  }

  const exit = context.enter("inlineMath");
  const result = `${sequence}${value}${sequence}`;
  exit();

  return result;
}

export function mathFormats(node: MdxNode): ReadonlySet<MathFormat> {
  function collectMathFormats(node: MdxNode, formats: Set<MathFormat>): void {
    if (node.kind === "inlineMath" || node.kind === "displayMath") {
      formats.add(node.format);
    }

    for (const child of mdxChildren(node)) {
      collectMathFormats(child, formats);
    }
  }

  const formats = new Set<MathFormat>();
  collectMathFormats(node, formats);

  return formats;
}
