import { assert, assertEquals } from "@std/assert";

import { MdxCompiler } from "./compiler.ts";
import { headingIdPlugin } from "./plugins/heading-id/plugin.ts";
import { treeProcessorPlugin } from "./plugins/tree-processor/plugin.ts";
import { syntaxHighlightPlugin } from "./plugins/syntax-highlight/plugin.ts";

Deno.test("mdx - compile", async () => {
  let headingCount = 0;
  const compiler = new MdxCompiler()
    .withRehypePlugin(headingIdPlugin, {
      prefix: "h-",
    })
    .withRehypePlugin(treeProcessorPlugin, {
      process: (element) => {
        if (element.tagName.startsWith("h")) {
          headingCount++;
        }
      },
    })
    .withRehypePlugin(syntaxHighlightPlugin, {
      languageClassNamePrefix: "language-",
      highlight: {
        transformer: { classActiveLine: "hl" },
      },
      lineNumbers: {},
    });

  const artifact = await compiler.compile<{ x: number }>(
    `
---
x: 42
---

# Hello
## Title 2
## Duplicate
## Duplicate

\`\`\`ts {"highlight":"2", "showLineNumbers":true}
type Mdx = never; // [!code highlight]
const x1 = 1;
\`\`\`
    `.trim(),
  );

  assertEquals(headingCount, 4);
  assertEquals(artifact.frontmatter.x, 42);

  const value = artifact.compiled;
  assert(typeof value === "string");
  assert(value.includes('"Hello"'));
  assert(value.includes('"h-title-2"'));

  assert(value.includes('className: "language-ts"'));
  assert(
    value.includes('"data-line": "1"') && value.includes('"data-line": "2"'),
  );
  assert(value.includes('className: "line hl line-number"'));
});
