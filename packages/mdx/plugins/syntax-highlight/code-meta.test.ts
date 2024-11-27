import { assertEquals } from "@std/assert";
import { extractCodeMeta } from "./code-meta.ts";

Deno.test("code meta - extract", () => {
  assertEquals(
    extractCodeMeta({
      data: {
        meta:
          '{"highlight": "3..5", "showLineNumbers":true, "fileName":"test"}',
      },
    }),
    {
      highlight: { lineRange: [{ from: 3, to: 4 }] },
      showLineNumbers: { lineRange: [] },
      fileName: "test",
    },
  );
});
