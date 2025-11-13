import { expect, test } from "vitest";
import { z } from "zod";

import { MdxCompiler } from "./compiler";
import { headingIdPlugin } from "./plugins/heading-id/plugin";
import { syntaxHighlightPlugin } from "./plugins/syntax-highlight/plugin";
import { treeProcessorPlugin } from "./plugins/tree-processor/plugin";

test("mdx - compile", async () => {
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

  expect(headingCount).toStrictEqual(4);
  expect(artifact.frontmatter.title).toStrictEqual("Test");
  expect(artifact.frontmatter.x).toStrictEqual(42);
  expect(artifact.frontmatter.b).toStrictEqual(true);

  await expect(() =>
    compiler.compile("", {}, frontmatterSchema),
  ).rejects.toThrow(z.ZodError);

  const value = artifact.compiled;
  expect(typeof value === "string").toStrictEqual(true);
  expect(value?.includes('"Hello"')).toStrictEqual(true);
  expect(value?.includes('"h-title-2"')).toStrictEqual(true);

  expect(value?.includes('"data-language": "ts"')).toStrictEqual(true);
  expect(value?.includes('"data-line-count": "2"')).toStrictEqual(true);
  expect(value?.includes('"data-source-code": "')).toStrictEqual(true);

  expect(
    value?.includes('"data-line": "1"') && value?.includes('"data-line": "2"'),
  ).toStrictEqual(true);
  expect(value?.includes('className: "line hl line-number"')).toStrictEqual(
    true,
  );
});

test("mdx - parse frontmatter", async () => {
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
  expect(fm1).toStrictEqual({ x: 42 });

  const fm2 = await compile(
    { s: "abc" },
    z.object({
      s: z.string(),
    }),
  );
  const _fm2type: { s: string } = fm2;
  expect(fm2).toStrictEqual({ s: "abc" });
});
