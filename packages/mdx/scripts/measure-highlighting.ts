import { performance } from "node:perf_hooks";
import { createHighlighter } from "shiki";

import { createShikiHighlighter, parseCodeBlockMetadata } from "../src/plugins/mod.ts";

const started = performance.now();

const shiki = await createHighlighter({ langs: ["typescript"], themes: ["github-light"] });

const startupMs = performance.now() - started;

try {
  const highlighter = createShikiHighlighter(shiki, { theme: "github-light" });
  const metadata = parseCodeBlockMetadata("").metadata;
  const results = [];

  for (const lines of [20, 100, 400]) {
    const code = "const value = 1;\n".repeat(lines);
    const before = performance.now();
    await highlighter.highlight({ code, language: "typescript", metadata });
    results.push({ lines, highlightMs: performance.now() - before });
  }

  console.log(JSON.stringify({ startupMs, results }, null, 2));
} finally {
  shiki.dispose();
}
