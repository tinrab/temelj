export interface Fixture {
  readonly name: string;
  readonly source: string;
}

const paragraph =
  "Streaming keeps completed paragraphs stable while new text arrives. " +
  "Read the **guide**, try *an example*, and follow [the documentation](/docs).\n\n";

const article = [
  "## Working with streams",
  "",
  paragraph,
  "> Keep the completed output and update the open block.",
  "> A quote can contain **formatted text** too.",
  "",
  "- Parse the source",
  "- Render the result with `formatHtml`",
  "  - Keep source offsets",
  "  - Report diagnostics",
  "",
  "```ts",
  "const stream = new MdxStream();",
  'stream.append("# Hello");',
  "stream.complete();",
  "```",
  "",
].join("\n");

export const syntheticFixtures: readonly Fixture[] = [
  {
    name: "short",
    source: "# Hello\n\nA **small** document with *emphasis* and a [link](/docs).\n",
  },
  { name: "article", source: article.repeat(8) },
  { name: "prose", source: paragraph.repeat(120) },
  {
    name: "references",
    source:
      "Read [the guide][g] and ![the logo][i].\n\n".repeat(60) +
      '[g]: /guide "Guide"\n[i]: /logo.png\n',
  },
  {
    name: "gfm",
    source: [
      "| Package | Output |",
      "| :--- | ---: |",
      "| **Temelj** | HTML |",
      "| remark | AST |",
      "",
      "- [x] Parse ~~old~~ content",
      "- [ ] Render the result",
      "",
      "",
    ]
      .join("\n")
      .repeat(30),
  },
  { name: "code", source: "```ts\n" + "const result = parse(source);\n".repeat(600) + "```\n" },
];

export const upstreamFixtures: readonly Fixture[] = [
  "ai-response",
  "code-heavy",
  "malformed",
  "prose-heavy",
  "small-doc",
  "tables-lists",
].map((name) => ({
  name: `tanstack/${name}`,
  source: readFileSync(new URL(`./fixtures/tanstack/${name}.md`, import.meta.url), "utf8"),
}));

export const markdownFixtures: readonly Fixture[] = [...syntheticFixtures, ...upstreamFixtures];

export const mdxFixtures: readonly Fixture[] = [
  {
    name: "component",
    source:
      "import { Card } from './card.js'\n\n" +
      "export const title = 'Hello'\n\n# {title}\n\n<Card title={title}>Some **content**.</Card>\n",
  },
  {
    name: "components",
    source:
      "import { Card } from './card.js'\n\n" +
      "## Example\n\n<Card count={2 + 3}>Read **this** and {String(42)}.</Card>\n\n".repeat(60),
  },
];

/** Include both many settled blocks and a single growing block. */
export const streamingFixtures: readonly Fixture[] = [
  ...upstreamFixtures,
  ...[32, 128].flatMap((count) => [
    { name: `paragraphs-${count}`, source: paragraph.repeat(count) },
    { name: `open-paragraph-${count}`, source: paragraph.replaceAll("\n", "").repeat(count) },
    {
      name: `fence-${count}`,
      source: "```ts\n" + "const value = 1;\n".repeat(count * 8) + "```\n",
    },
    { name: `list-${count}`, source: "- item with *emphasis*\n".repeat(count * 4) },
    {
      name: `late-definitions-${count}`,
      source: "Read [the guide][g].\n\n".repeat(count * 2) + "[g]: /guide\n",
    },
  ]),
];

import { readFileSync } from "node:fs";
