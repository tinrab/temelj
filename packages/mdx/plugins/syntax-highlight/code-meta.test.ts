import { expect, test } from "vitest";

import { extractCodeMeta } from "./code-meta";

test("code meta - extract", () => {
  expect(
    extractCodeMeta({
      type: "element",
      tagName: "pre",
      properties: {},
      children: [],
      data: {
        meta: '{"highlight": "3..5", "showLineNumbers":true, "fileName":"test"}',
      },
    }),
    {
      highlight: { lineRange: [{ from: 3, to: 4 }] },
      showLineNumbers: { lineRange: [] },
      fileName: "test",
    },
  );
});
