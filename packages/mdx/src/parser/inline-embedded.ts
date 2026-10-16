import type { SourceText } from "../source-text.ts";
import type { InlineInput } from "./inline-input.ts";
import type { InlineMatch } from "./inline-output.ts";
import type { InlineSyntax } from "./inline-syntax.ts";

import { JsxBoundaryScanner } from "./embedded-scanner.ts";
import { textNode } from "./inline-output.ts";
import { parseJavaScriptBoundary } from "./javascript-boundary.ts";
import { JavaScriptScanner } from "./javascript-scanner.ts";

// Inline JSX, raw HTML, autolinks in angle brackets, and expressions.

interface OptionalInlineMatch {
  readonly end: number;
  readonly node: InlineSyntax | undefined;
  readonly open: boolean;
}

interface AngleMatch extends InlineMatch {
  readonly invalid: boolean;
  readonly open: boolean;
}

export function expressionNode(
  input: InlineInput,
  value: SourceText,
  start: number,
): OptionalInlineMatch | undefined {
  const scanner = new JavaScriptScanner("}");
  const structural = scanner.append(value.slice(start + 1));

  if (structural.kind === "open") {
    return { end: value.length, node: undefined, open: true };
  }

  const end = start + 1 + structural.offset;

  if (structural.kind === "invalid") {
    return { end, node: undefined, open: false };
  }

  const authored = value.slice(start + 1, end - 1);

  const boundary =
    authored.trim() === ""
      ? undefined
      : parseJavaScriptBoundary(
          "expression",
          authored,
          input.sourceRange(start + 1, start + 1).start,
        );

  return {
    end,
    open: false,
    node:
      authored.trim() === "" || boundary?.kind === "valid"
        ? {
            kind: "expression",
            range: input.sourceRange(start, end),
            value: authored,
          }
        : undefined,
  };
}

export function angleNode(
  input: InlineInput,
  value: SourceText,
  start: number,
): AngleMatch | undefined {
  const rest = value.slice(start);

  if (/^<(?:!--|!\[CDATA\[|\?|!)/u.test(rest)) {
    const closing = rest.startsWith("<!--")
      ? "-->"
      : rest.startsWith("<![CDATA[")
        ? "]] >".replace(" ", "")
        : rest.startsWith("<?")
          ? "?>"
          : ">";

    const close = rest.indexOf(closing, 2);

    if (close === -1) {
      return;
    }

    const end = start + close + closing.length;

    return {
      end,
      invalid: false,
      open: false,
      node: {
        kind: "rawHtml",
        range: input.sourceRange(start, end),
        value: value.slice(start, end),
      },
    };
  }

  if (
    !/^<(?:>|\/(?:>|[A-Za-z_$][\w$-]*(?:[.:][A-Za-z_$][\w$-]*)*(?=[\s>]))|[A-Za-z_$][\w$-]*(?:[.:][A-Za-z_$][\w$-]*)*(?=[\s/{>]))/u.test(
      rest,
    )
  ) {
    const autolink = /^<((?:https?:\/\/|mailto:)[^ <>]+|[^ <>@]+@[^ <>@]+)>/u.exec(rest);

    if (autolink === null) {
      return;
    }

    const end = start + autolink[0].length;
    const label = autolink[1];

    const destination =
      label.includes("@") && !label.startsWith("mailto:") ? `mailto:${label}` : label;

    return {
      end,
      invalid: false,
      open: false,
      node: {
        kind: "link",
        range: input.sourceRange(start, end),
        destination,
        title: undefined,
        children: [textNode(input, value, start + 1, end - 1)],
      },
    };
  }

  const scanner = new JsxBoundaryScanner();
  const structural = scanner.append(rest);
  const end = structural.kind === "open" ? value.length : start + structural.offset;

  if (structural.kind !== "closed") {
    return {
      end,
      invalid: true,
      open: structural.kind === "open",
      node: textNode(input, value, start, end),
    };
  }

  const authored = value.slice(start, end);

  const boundary = parseJavaScriptBoundary(
    "jsxExpression",
    authored,
    input.sourceRange(start, start).start,
  );

  const valid = boundary.kind === "valid";

  return {
    end,
    invalid: !valid,
    open: false,
    node: valid
      ? { kind: "jsx", range: input.sourceRange(start, end), value: authored }
      : textNode(input, value, start, end),
  };
}
