import { describe, expect, it } from "vitest";

import {
  formatHtml,
  MdxStream,
  parse,
  lowerHtml,
  previewDocument,
  type MdxStreamSnapshot,
} from "./mod.ts";

const fixtures = {
  lists: "Intro\n\n- one\n- two\n\n  continued\n- three\n\n1. first\n2. second\n",
  emphasis: "Some **strong *nested* text** and `code` with a [link](https://example.com).\n",
  fence: "Before\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nAfter\n",
  jsx: '<Note title="x">\n# Heading\n\n- a\n- b\n</Note>\n\nAfter {1 + 1} text <span>inline</span>.\n',
  quote: "> quoted\n> lines\n\n> second\n",
  references:
    "See [the guide][guide] and [^note].\n\n[guide]: https://example.com\n\n[^note]: Footnote.\n",
};

function html(snapshot: MdxStreamSnapshot): string {
  return formatHtml(previewDocument(snapshot));
}

function previews(source: string): MdxStreamSnapshot[] {
  const stream = new MdxStream();
  const snapshots: MdxStreamSnapshot[] = [];

  for (const character of source) {
    snapshots.push(stream.append(character));
  }

  return snapshots;
}

describe("streaming prefix sweep", () => {
  it.each(Object.entries(fixtures))("streams %s without failures", (_, source) => {
    const snapshots = previews(source);

    for (const [index, snapshot] of snapshots.entries()) {
      expect({
        prefix: source.slice(0, index + 1),
        kind: snapshot.kind,
        limit: snapshot.limit,
        invalid: snapshot.blocks.filter((block) => block.status === "invalid").length,
      }).toEqual({
        prefix: source.slice(0, index + 1),
        kind: "preview",
        limit: undefined,
        invalid: 0,
      });
      expect(() => html(snapshot)).not.toThrow();
    }
  });

  it.each(Object.entries(fixtures))("keeps settled %s block identities", (_, source) => {
    const snapshots = previews(source);

    for (let index = 1; index < snapshots.length; index++) {
      const previous = snapshots[index - 1].blocks.map((block) => block.id);
      const current = snapshots[index].blocks.map((block) => block.id);

      // Appending only changes the open tail, so every earlier identity except the last survives.
      expect(current.slice(0, previous.length - 1)).toEqual(previous.slice(0, -1));
    }
  });

  it.each(Object.entries(fixtures))("is deterministic for %s prefixes", (_, source) => {
    const snapshots = previews(source);

    for (const [index, snapshot] of snapshots.entries()) {
      const fresh = new MdxStream({ source: source.slice(0, index + 1) }).snapshot();

      expect(fresh.kind === "preview" ? html(fresh) : undefined).toBe(html(snapshot));
    }
  });

  it.each(Object.entries(fixtures))("completes %s like the strict parser", (_, source) => {
    const stream = new MdxStream();
    stream.append(source);
    const completion = stream.complete();
    const parsed = parse(source);

    const html = (outcome: typeof parsed): string => formatHtml(lowerHtml(outcome.document));

    expect(html(completion)).toBe(html(parsed));
  });
});

describe("streaming tail", () => {
  it.each([
    ["- one\n- two\n\n-", ["one", "two"]],
    ["- one\n-", ["one"]],
    ["- one\n\n3.", ["one"]],
  ])("keeps a list visible when %j ends with a bare marker", (source, items) => {
    const rendered = html(new MdxStream({ source }).append(""));

    for (const item of items) {
      expect(rendered).toContain(item);
    }

    expect(rendered).not.toMatch(/<li>\s*<\/li>/u);
  });

  it("does not render an empty trailing heading", () => {
    expect(html(new MdxStream({ source: "Text\n\n#" }).append(""))).toBe("<p>Text</p>");
  });

  it.each(["Text <span>inl", "Hi {na"])("keeps %j valid while inline MDX is open", (source) => {
    const snapshot = new MdxStream({ source }).append("");

    expect(snapshot.blocks.map((block) => block.status)).toEqual(["valid"]);
    expect(snapshot.diagnostics).toEqual([]);
    expect(html(snapshot)).toContain(source.split(/[<{]/u)[0].trim());
  });

  it("isolates closed invalid MDX to its own block", () => {
    const stream = new MdxStream();
    stream.append("one\n\n");
    const snapshot = stream.append("{1+}\n\nnext");

    expect(snapshot.blocks.map((block) => block.status)).toEqual(["valid", "invalid", "valid"]);
    expect(snapshot.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "mdx.expression.invalid",
    ]);
    expect(html(snapshot)).toContain("next");
    expect(html(snapshot)).toContain("{1+}");
  });

  it("keeps block identities across an invalid state", () => {
    const stream = new MdxStream();
    stream.append("one\n\ntwo\n\n");
    const invalid = stream.append("{1+}\n\nnext");
    const repaired = stream.edit({ start: 10, end: 14, text: "{1}" });
    const ids = invalid.blocks.map((block) => block.id);

    expect(repaired.blocks.every((block) => block.status === "valid")).toBe(true);
    expect(repaired.blocks.map((block) => block.id)).toEqual([
      ids[0],
      ids[1],
      expect.any(String),
      ids[3],
    ]);
  });

  it("renders pending flow JSX children as Markdown blocks", () => {
    const snapshot = new MdxStream({ source: "<Note>\n# Head\n\n- a\n- b" }).append("");
    const jsx = snapshot.blocks[0]?.nodes[0];

    expect(jsx).toMatchObject({ kind: "jsx", state: "pending", name: "Note" });
    expect(
      jsx?.kind === "jsx"
        ? jsx.children.map((child) => (child.kind === "element" ? child.tagName : child.kind))
        : [],
    ).toEqual(["h1", "ul"]);
  });

  it("keeps pending JSX safe when its children contain an expression", () => {
    const jsx = new MdxStream({ source: "<Note>Hello {x}" }).append("").blocks[0]?.nodes[0];

    expect(jsx).toMatchObject({ kind: "jsx", state: "pending", name: "Note" });
  });
});

describe("strict lists and JSX", () => {
  it.each([
    ["- a\n- b\n", "<ul>\n<li>a</li>\n<li>b</li>\n</ul>"],
    ["- a\n\n- b", "<ul>\n<li>\n<p>a</p>\n</li>\n<li>\n<p>b</p>\n</li>\n</ul>"],
    ["- a\n  - b\n\n  c", "<ul>\n<li>\n<p>a</p>\n<ul>\n<li>b</li>\n</ul>\n<p>c</p>\n</li>\n</ul>"],
    [
      "- a\n  - b\n\n  - c",
      "<ul>\n<li>a\n<ul>\n<li>\n<p>b</p>\n</li>\n<li>\n<p>c</p>\n</li>\n</ul>\n</li>\n</ul>",
    ],
    ["a\n-", "<h2>a</h2>"],
    ["- a\n  -", "<ul>\n<li>\n<h2>a</h2>\n</li>\n</ul>"],
  ])("renders %j", (source, html) => {
    const parsed = parse(source);

    expect(formatHtml(lowerHtml(parsed.document))).toBe(html);
  });

  it("parses multi-line flow JSX children as blocks", () => {
    const parsed = parse("<Note>\n# Head\n\n- a\n\n<B>\ntext\n</B>\n</Note>");
    const jsx = parsed.document.children[0];

    expect(jsx?.kind).toBe("jsxFlowElement");
    expect(jsx?.kind === "jsxFlowElement" ? jsx.children.map((child) => child.kind) : []).toEqual([
      "heading",
      "list",
      "jsxFlowElement",
    ]);
  });
});
