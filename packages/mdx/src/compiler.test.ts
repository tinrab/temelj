import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import type { Plugin } from "unified";
import { expect, test } from "vitest";
import * as z from "zod";

import { MdxCompileError, MdxCompiler } from "./compiler";
import { headingIdPlugin } from "./plugins/heading-id/plugin";
import { syntaxHighlightPlugin } from "./plugins/syntax-highlight/plugin";
import { treeProcessorPlugin } from "./plugins/tree-processor/plugin";
import type { HastElement } from "./types";

const rehypeKatexPlugin = rehypeKatex as unknown as Plugin;

test("mdx - compile", async () => {
  let headingCount = 0;
  const compiler = new MdxCompiler()
    .withRehypePlugin(headingIdPlugin, {
      prefix: "h-",
    })
    .withRehypePlugin(treeProcessorPlugin, {
      process: (element: HastElement) => {
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

test("mdx - malformed latex is reported as diagnostic", async () => {
  const compiler = new MdxCompiler()
    .withRemarkPlugin(remarkMath)
    .withRehypePlugin(rehypeKatexPlugin);

  const source = [
    "Hello, World!",
    "This is $2$nd line, the one with faulty: $\\f$$42$ GB",
  ].join("\n");

  const artifact = await compiler.compile(source);

  expect(typeof artifact.compiled).toStrictEqual("string");
  expect(artifact.messages).toHaveLength(1);
  expect(artifact.messages[0]).toMatchObject({
    source: "rehype-katex",
    reason: "Could not render math with KaTeX",
    line: 2,
    sourceLine: "This is $2$nd line, the one with faulty: $\\f$$42$ GB",
    snippet: "$\\f$$42$",
    cause: {
      name: "ParseError",
    },
  });
  expect(artifact.messages[0].message).toContain(
    "Could not render math with KaTeX",
  );
  expect(artifact.messages[0].message).toContain("Source: $\\f$$42$");
});

test("mdx - compile errors include source context", async () => {
  const compiler = new MdxCompiler();
  const source = ["# Hello", "export const answer = ;"].join("\n");

  await expect(compiler.compile(source)).rejects.toThrow(MdxCompileError);

  try {
    await compiler.compile(source);
  } catch (error) {
    expect(error).toBeInstanceOf(MdxCompileError);
    const mdxError = error as MdxCompileError;
    expect(mdxError.line).toStrictEqual(2);
    expect(mdxError.sourceLine).toStrictEqual("export const answer = ;");
    expect(mdxError.snippet).toStrictEqual(";");
    expect(mdxError.message).toContain("at 2");
    expect(mdxError.message).toContain("Source: ;");
    expect(mdxError.message).toContain("Line: export const answer = ;");
  }
});

test("mdx - compile errors use frontmatter-stripped source locations", async () => {
  const compiler = new MdxCompiler();
  const source = [
    "---",
    "title: Test",
    "---",
    "",
    "# Hello",
    "",
    "The W{weight bits}A{activation bits} format uses ternary weights.",
  ].join("\n");

  await expect(compiler.compile(source)).rejects.toThrow(MdxCompileError);

  try {
    await compiler.compile(source);
  } catch (error) {
    expect(error).toBeInstanceOf(MdxCompileError);
    const mdxError = error as MdxCompileError;
    expect(mdxError.line).toStrictEqual(7);
    expect(mdxError.column).toStrictEqual(6);
    expect(mdxError.source).toStrictEqual("micromark-extension-mdx-expression");
    expect(mdxError.ruleId).toStrictEqual("acorn");
    expect(mdxError.sourceLine).toStrictEqual(
      "The W{weight bits}A{activation bits} format uses ternary weights.",
    );
    expect(mdxError.snippet).toStrictEqual("W{weight bits}A{activation bits}");
    expect(mdxError.sourcePointer).toStrictEqual("     ^");
    expect(mdxError.message).toContain("at 7:6");
    expect(mdxError.message).toContain(
      "Source: W{weight bits}A{activation bits}",
    );
    expect(mdxError.message).toContain(
      "Line: The W{weight bits}A{activation bits} format uses ternary weights.",
    );
    expect(mdxError.message).toContain("     ^");
    expect(mdxError.message).toContain(
      "Cause: Unexpected content after expression",
    );
    expect(mdxError.hint).toContain("MDX treats `{...}` as JavaScript");
  }
});

test("mdx - compile errors keep actual JS expression locations", async () => {
  const compiler = new MdxCompiler();
  const source = ["# Hello", "Value is {foo bar} baz"].join("\n");

  await expect(compiler.compile(source)).rejects.toThrow(MdxCompileError);

  try {
    await compiler.compile(source);
  } catch (error) {
    expect(error).toBeInstanceOf(MdxCompileError);
    const mdxError = error as MdxCompileError;
    expect(mdxError.line).toStrictEqual(2);
    expect(mdxError.column).toStrictEqual(10);
    expect(mdxError.sourceLine).toStrictEqual("Value is {foo bar} baz");
    expect(mdxError.snippet).toStrictEqual("{foo bar}");
    expect(mdxError.sourcePointer).toStrictEqual("         ^");
    expect(mdxError.hint).toContain("MDX treats `{...}` as JavaScript");
    expect(mdxError.message).toContain("at 2:10");
    expect(mdxError.message).toContain("Source: {foo bar}");
    expect(mdxError.message).toContain(
      "Cause: Unexpected content after expression",
    );
    expect(mdxError.message).toContain(
      "Hint: MDX treats `{...}` as JavaScript.",
    );
  }
});
