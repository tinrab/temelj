import { describe, expect, it } from "vitest";

import {
  formatHtml,
  MdxStream,
  parse,
  lowerHtml,
  renderStreamingHtml,
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
        status: snapshot.status,
      }).toEqual({
        prefix: source.slice(0, index + 1),
        kind: "preview",
        status: "valid",
      });
      expect(() => renderStreamingHtml(snapshot.document)).not.toThrow();
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

      expect(fresh.kind === "preview" ? renderStreamingHtml(fresh.document) : undefined).toBe(
        renderStreamingHtml(snapshot.document),
      );
    }
  });

  it.each(Object.entries(fixtures))("completes %s like the strict parser", (_, source) => {
    const stream = new MdxStream();
    stream.append(source);
    const completion = stream.complete();
    const parsed = parse(source);

    const html = (outcome: typeof parsed): string =>
      outcome.kind === "ok" ? formatHtml(lowerHtml(outcome.document)) : outcome.kind;

    expect(completion.kind).toBe("ok");
    expect(html(completion)).toBe(html(parsed));
  });
});

describe("streaming tail", () => {
  it.each([
    ["- one\n- two\n\n-", ["one", "two"]],
    ["- one\n-", ["one"]],
    ["- one\n\n3.", ["one"]],
  ])("keeps a list visible when %j ends with a bare marker", (source, items) => {
    const html = renderStreamingHtml(new MdxStream({ source }).append("").document);

    for (const item of items) {
      expect(html).toContain(item);
    }

    expect(html).not.toMatch(/<li>\s*<\/li>/u);
  });

  it("does not render an empty trailing heading", () => {
    expect(renderStreamingHtml(new MdxStream({ source: "Text\n\n#" }).append("").document)).toBe(
      "<p>Text</p>",
    );
  });

  it.each(["Text <span>inl", "Hi {na"])("keeps %j valid while inline MDX is open", (source) => {
    const snapshot = new MdxStream({ source }).append("");

    expect(snapshot.status).toBe("valid");
    expect(snapshot.diagnostics).toEqual([]);
    expect(renderStreamingHtml(snapshot.document)).toContain(source.split(/[<{]/u)[0].trim());
  });

  it("isolates closed invalid MDX to its own block", () => {
    const stream = new MdxStream();
    stream.append("one\n\n");
    const snapshot = stream.append("{1+}\n\nnext");

    expect(snapshot.status).toBe("invalid");
    expect(snapshot.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "mdx.expression.invalid",
    ]);
    expect(renderStreamingHtml(snapshot.document)).toContain("next");
    expect(renderStreamingHtml(snapshot.document)).toContain("{1+}");
  });

  it("keeps block identities across an invalid state", () => {
    const stream = new MdxStream();
    stream.append("one\n\ntwo\n\n");
    const invalid = stream.append("{1+}\n\nnext");
    const repaired = stream.edit({ start: 10, end: 14, text: "{1}" });
    const ids = invalid.blocks.map((block) => block.id);

    expect(repaired.status).toBe("valid");
    expect(repaired.blocks.map((block) => block.id)).toEqual([
      ids[0],
      ids[1],
      expect.any(String),
      ids[3],
    ]);
  });

  it("renders pending flow JSX children as Markdown blocks", () => {
    const snapshot = new MdxStream({ source: "<Note>\n# Head\n\n- a\n- b" }).append("");
    const jsx = snapshot.document.children[0];

    expect(jsx?.kind).toBe("jsx");
    expect(jsx?.kind === "jsx" && jsx.safe).toBe(true);
    expect(
      jsx?.kind === "jsx"
        ? jsx.children.map((child) => (child.kind === "element" ? child.tagName : child.kind))
        : [],
    ).toEqual(["h1", "text", "ul"]);
  });

  it("keeps pending JSX safe when its children contain an expression", () => {
    const jsx = new MdxStream({ source: "<Note>Hello {x}" }).append("").document.children[0];

    expect(jsx?.kind === "jsx" && jsx.safe).toBe(true);
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

    expect(parsed.kind === "ok" ? formatHtml(lowerHtml(parsed.document)) : parsed.kind).toBe(html);
  });

  it("parses multi-line flow JSX children as blocks", () => {
    const parsed = parse("<Note>\n# Head\n\n- a\n\n<B>\ntext\n</B>\n</Note>");
    const jsx = parsed.kind === "ok" ? parsed.document.children[0] : undefined;

    expect(jsx?.kind).toBe("jsxFlowElement");
    expect(jsx?.kind === "jsxFlowElement" ? jsx.children.map((child) => child.kind) : []).toEqual([
      "heading",
      "list",
      "jsxFlowElement",
    ]);
  });
});
