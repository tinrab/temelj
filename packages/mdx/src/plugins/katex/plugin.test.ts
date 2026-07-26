import type { Element, Root } from "hast";

import { fromHtmlIsomorphic } from "hast-util-from-html-isomorphic";
import { toText } from "hast-util-to-text";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { VFile } from "vfile";
import { expect, expectTypeOf, test } from "vitest";

import { katexPlugin, type KatexPluginOptions } from "./plugin";

async function transform(
  html: string,
  options?: KatexPluginOptions,
): Promise<{
  file: VFile;
  tree: Root;
}> {
  const file = new VFile({ value: html });
  const tree = fromHtmlIsomorphic(html, { fragment: true });
  await unified().use(katexPlugin, options).run(tree, file);

  return { file, tree };
}

function findElements(tree: Root, tagName: string): Element[] {
  const elements: Element[] = [];

  visit(tree, "element", (element) => {
    if (element.tagName === tagName) {
      elements.push(element);
    }
  });

  return elements;
}

test("katexPlugin renders inline and display math", async () => {
  const { tree } = await transform(
    [
      '<p>Inline <span class="math-inline">\\alpha</span>.</p>',
      '<div class="math-display">\\gamma</div>',
    ].join(""),
  );

  const paragraph = tree.children[0];
  const display = tree.children[1];

  expect(paragraph).toMatchObject({
    type: "element",
    children: [
      { type: "text", value: "Inline " },
      { type: "element", properties: { className: ["katex"] } },
      { type: "text", value: "." },
    ],
  });
  expect(display).toMatchObject({
    type: "element",
    properties: { className: ["katex-display"] },
  });
});

test("katexPlugin replaces fenced math code and preserves whitespace", async () => {
  const { tree } = await transform('<pre><code class="language-math">x + y\n</code></pre>');

  expect(tree.children).toHaveLength(1);
  expect(tree.children[0]).toMatchObject({
    type: "element",
    properties: { className: ["katex-display"] },
  });
  expect(toText(tree)).toContain("x+y");
});

test("katexPlugin passes caller options to KaTeX", async () => {
  const { tree } = await transform('<span class="math-inline">\\RR</span>', {
    macros: { "\\RR": "\\mathbb{R}" },
    output: "mathml",
  });

  expect(tree.children[0]).toMatchObject({
    type: "element",
    properties: { className: ["katex"] },
    children: [{ type: "element", tagName: "math" }],
  });
  expect(toText(tree)).toContain("R");
});

test("katexPlugin preserves KaTeX's default inline math style", async () => {
  const { tree } = await transform('<span class="math-inline">\\frac{64}{5}</span>', {
    output: "mathml",
  });

  expect(findElements(tree, "mfrac")).toHaveLength(1);
  expect(findElements(tree, "mstyle")).toHaveLength(0);
});

test.each([
  ["display", "0", "true"],
  ["text", "0", "false"],
  ["script", "1", "false"],
  ["scriptscript", "2", "false"],
] as const)(
  "katexPlugin applies %s TeX style without changing inline layout",
  async (inlineMathStyle, scriptLevel, displayStyle) => {
    const { tree } = await transform('<span class="math-inline">\\frac{64}{5}</span>', {
      inlineMathStyle,
      output: "mathml",
    });

    expect(tree.children[0]).toMatchObject({
      type: "element",
      properties: { className: ["katex"] },
    });
    expect(findElements(tree, "mstyle")).toEqual([
      expect.objectContaining({
        properties: {
          displaystyle: displayStyle,
          scriptlevel: scriptLevel,
        },
      }),
    ]);
    expect(findElements(tree, "mfrac")).toHaveLength(1);
  },
);

test("katexPlugin styles each inline node while preserving mixed prose", async () => {
  const { tree } = await transform(
    '<p>The value is <span class="math-inline">\\frac{64}{5}</span> units, not <span class="math-inline">x^2</span>.</p>',
    { inlineMathStyle: "display", output: "mathml" },
  );

  expect(tree.children[0]).toMatchObject({
    type: "element",
    tagName: "p",
    children: [
      { type: "text", value: "The value is " },
      { type: "element", properties: { className: ["katex"] } },
      { type: "text", value: " units, not " },
      { type: "element", properties: { className: ["katex"] } },
      { type: "text", value: "." },
    ],
  });
  expect(findElements(tree, "mstyle")).toHaveLength(2);
});

test("katexPlugin does not apply inline style to display or fenced math", async () => {
  const { tree } = await transform(
    [
      '<div class="math-display">\\frac{64}{5}</div>',
      '<pre><code class="language-math">\\frac{32}{5}\n</code></pre>',
    ].join(""),
    { inlineMathStyle: "display", output: "mathml" },
  );

  expect(findElements(tree, "mstyle")).toHaveLength(0);
  expect(findElements(tree, "math").map((element) => element.properties.display)).toStrictEqual([
    "block",
    "block",
  ]);
});

test("katexPlugin reports malformed input and renders KaTeX error output", async () => {
  const { file, tree } = await transform('<span class="math-inline">\\notacommand</span>', {
    errorColor: "orange",
  });

  expect(file.messages).toHaveLength(1);
  expect(file.messages[0]).toMatchObject({
    reason: "Could not render math with KaTeX",
    ruleId: "parseerror",
    source: "rehype-katex",
    cause: { name: "ParseError" },
  });
  expect(tree.children[0]).toMatchObject({
    type: "element",
    properties: { className: ["katex"] },
  });
});

test("katexPlugin falls back to plain error markup when KaTeX cannot recover", async () => {
  const source = "\\begin{split}\n\\end{{split}}\n";
  const { file, tree } = await transform(`<span class="math-inline">${source}</span>`, {
    inlineMathStyle: "display",
  });

  expect(file.messages).toHaveLength(1);
  expect(tree.children[0]).toMatchObject({
    type: "element",
    properties: {
      className: ["katex-error"],
      style: "color:#cc0000",
    },
    children: [{ type: "text", value: source }],
  });
  expect(tree.children[0]).not.toHaveProperty(
    "properties.title",
    expect.stringContaining("\\displaystyle"),
  );
});

test("KatexPluginOptions reserves rendering mode and error handling", () => {
  const options = {
    inlineMathStyle: "display",
  } satisfies KatexPluginOptions;
  const invalidOptions = {
    // @ts-expect-error Unknown TeX styles are not accepted.
    inlineMathStyle: "invalid",
  } satisfies KatexPluginOptions;

  expect(options.inlineMathStyle).toStrictEqual("display");
  expect(invalidOptions.inlineMathStyle).toStrictEqual("invalid");
  expectTypeOf<KatexPluginOptions>().toHaveProperty("inlineMathStyle");
  expectTypeOf<KatexPluginOptions>().not.toHaveProperty("displayMode");
  expectTypeOf<KatexPluginOptions>().not.toHaveProperty("throwOnError");
});
