import { assert, assertEquals, assertRejects } from "@std/assert";
import { z } from "zod";

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
      includeDataAttributes: ["language", "source-code", "line-count"],
      highlight: {
        transformer: { classActiveLine: "hl" },
      },
      lineNumbers: {},
    });

  const frontmatterSchema = z.object({
    title: z.string(),
    x: z.optional(z.number()),
    b: z.optional(z.boolean()).default(true),
  });

  const artifact = await compiler.compile(
    `
---
title: Test
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
    {},
    frontmatterSchema,
  );

  assertEquals(headingCount, 4);
  assertEquals(artifact.frontmatter.title, "Test");
  assertEquals(artifact.frontmatter.x, 42);
  assertEquals(artifact.frontmatter.b, true);

  assertRejects(() => compiler.compile("", {}, frontmatterSchema), z.ZodError);

  const value = artifact.compiled;
  assert(typeof value === "string");
  assert(value.includes('"Hello"'));
  assert(value.includes('"h-title-2"'));

  assert(value.includes('"data-language": "ts"'));
  assert(value.includes('"data-line-count": "2"'));
  assert(value.includes('"data-source-code": "'));

  assert(
    value.includes('"data-line": "1"') && value.includes('"data-line": "2"'),
  );
  assert(value.includes('className: "line hl line-number"'));
});

Deno.test("mdx - parse frontmatter", async () => {
  async function compile<TFrontmatterSchema extends z.ZodSchema>(
    frontmatter: Record<string, unknown>,
    schema: TFrontmatterSchema,
  ): Promise<z.output<TFrontmatterSchema>> {
    const compiler = new MdxCompiler();

    const artifact = await compiler.compile(
      `
---
${JSON.stringify(frontmatter)}
---
    `.trim(),
      {},
      schema,
    );
    return artifact.frontmatter;
  }

  const fm1 = await compile(
    { x: 42 },
    z.object({
      x: z.number(),
    }),
  );
  const _fm1type: { x: number } = fm1;
  assertEquals(fm1, { x: 42 });

  const fm2 = await compile(
    { s: "abc" },
    z.object({
      s: z.string(),
    }),
  );
  const _fm2type: { s: string } = fm2;
  assertEquals(fm2, { s: "abc" });
});
