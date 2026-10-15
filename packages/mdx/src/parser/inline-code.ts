import type { SourceText } from "../source-text.ts";
import type { InlineInput } from "./inline-input.ts";
import type { InlineMatch } from "./inline-output.ts";

import { markerRunEnd } from "./inline-output.ts";

// Code spans.

export function codeSpan(
  input: InlineInput,
  value: SourceText,
  start: number,
): InlineMatch | undefined {
  const openerEnd = markerRunEnd(value, start, "`");
  const size = openerEnd - start;
  let search = openerEnd;

  while (search < value.length) {
    const candidate = value.indexOf("`", search);

    if (candidate === -1) {
      return;
    }

    const end = markerRunEnd(value, candidate, "`");

    if (end - candidate === size) {
      let code = value.slice(openerEnd, candidate).replace(/\r\n|[\r\n]/gu, " ");

      if (/^ .* $/u.test(code) && /[^ ]/u.test(code)) {
        code = code.slice(1, -1);
      }

      return {
        end,
        node: { kind: "code", range: input.sourceRange(start, end), value: code },
      };
    }

    search = end;
  }

  return;
}
