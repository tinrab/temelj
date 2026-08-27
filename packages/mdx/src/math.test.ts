import { describe, expect, expectTypeOf, it } from "vitest";

import {
  DisplayMathNode,
  InlineMathNode,
  InputError,
  MdxStream,
  ParagraphNode,
  TextNode,
  parse,
  renderStreamingHtml,
  selectMdx,
  type MathFormat,
  type MathMode,
  type StreamingDocument,
  type SyntaxOptions,
} from "./mod.ts";

function inlineMath(source: string, mode: MathMode): readonly InlineMathNode[] {
  return Array.from(
    selectMdx(expectParsed(parse(source, { syntax: { math: mode } })).document, "inlineMath"),
    ({ node }) => node,
  );
}

function displayMath(source: string, mode: MathMode): readonly DisplayMathNode[] {
  return Array.from(
    selectMdx(expectParsed(parse(source, { syntax: { math: mode } })).document, "displayMath"),
    ({ node }) => node,
  );
}

describe("math syntax modes", () => {
  it("is disabled by default", () => {
    const document = expectParsed(parse("$x$ and \\(y\\)\n\n\\[z\\]\n")).document;

    expect([...selectMdx(document, "inlineMath")]).toHaveLength(0);
    expect([...selectMdx(document, "displayMath")]).toHaveLength(0);
  });

  it("selects dollar or TeX delimiters independently", () => {
    expect(inlineMath("$x$ and \\(y\\)", "dollar").map((node) => node.value)).toEqual(["x"]);
    expect(inlineMath("$x$ and \\(y\\)", "tex").map((node) => node.value)).toEqual(["y"]);
  });

  it("parses both delimiter families in auto mode", () => {
    const source = "$a$ and \\(b\\)\n\n$$\nc\n$$\n\n\\[\nd\n\\]\n";
    const document = expectParsed(parse(source, { syntax: { math: "auto" } })).document;

    expect(
      [...selectMdx(document, "inlineMath")].map(({ node }) => [node.format, node.value]),
    ).toEqual([
      ["dollar", "a"],
      ["tex", "b"],
    ]);
    expect(
      [...selectMdx(document, "displayMath")].map(({ node }) => [node.format, node.value]),
    ).toEqual([
      ["dollar", "c"],
      ["tex", "d"],
    ]);
  });

  it("allows multiline TeX inline math", () => {
    expect(inlineMath("before \\(a\n+b\\) after", "tex")[0]).toMatchObject({
      format: "tex",
      value: "a\n+b",
    });
  });

  it("accepts same-line and multiline TeX display math only at a flow boundary", () => {
    expect(displayMath("\\[x\\]", "tex")[0]).toMatchObject({ format: "tex", value: "x" });
    expect(displayMath("\\[\nx + y\n\\]", "tex")[0]).toMatchObject({
      format: "tex",
      value: "x + y",
    });
    expect(displayMath("\\[x\\] \t", "tex")).toHaveLength(1);
    expect(displayMath("\\[x\\] trailing", "tex")).toHaveLength(0);
    expect(displayMath("before \\[x\\] after", "tex")).toHaveLength(0);
  });

  it("removes container prefixes from multiline TeX display values", () => {
    expect(displayMath("- \\[\n  x\n  \\]", "tex")[0]?.value).toBe("x");
    expect(displayMath("> \\[\n> y\n> \\]", "tex")[0]?.value).toBe("y");
  });

  it("retains existing dollar delimiter and metadata behavior", () => {
    expect(inlineMath("$a$, $$b$$, $$$c$$$", "dollar").map((node) => node.value)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(displayMath("$$ equation\nx + y\n$$", "dollar")[0]).toMatchObject({
      format: "dollar",
      meta: "equation",
      value: "x + y",
    });
  });

  it("leaves escaped and unclosed TeX delimiters as ordinary MDX", () => {
    expect(inlineMath(String.raw`\\(x\)`, "tex")).toHaveLength(0);
    expect(inlineMath(String.raw`\(x`, "tex")).toHaveLength(0);
    expect(displayMath(String.raw`\[x`, "tex")).toHaveLength(0);
  });
});

describe("math nodes and formatting", () => {
  it("preserves the resolved delimiter format through formatting", () => {
    const source = "$a$ and \\(b\\)\n\n\\[\nc\n\\]\n";
    const first = expectParsed(parse(source, { syntax: { math: "auto" } })).document;
    const formatted = first.toSource();
    const second = expectParsed(parse(formatted, { syntax: { math: "auto" } })).document;

    expect([...selectMdx(second, "inlineMath")].map(({ node }) => node.format)).toEqual([
      "dollar",
      "tex",
    ]);
    expect([...selectMdx(second, "displayMath")].map(({ node }) => node.format)).toEqual(["tex"]);
    expect(formatted).toContain("\\(b\\)");
    expect(formatted).toContain("\\[\nc\n\\]");
  });

  it("escapes prose that would become enabled TeX math", () => {
    const document = new ParagraphNode([new TextNode(String.raw`literal \(x\)`)]);
    const source = document.toSource({ syntax: { math: "tex" } });

    expect(inlineMath(source, "tex")).toHaveLength(0);
  });

  it("requires formats in constructors and rejects ambiguous TeX node values", () => {
    expect(new InlineMathNode("x", { format: "tex" }).toSource()).toBe("\\(x\\)");
    expect(new DisplayMathNode("x", { format: "tex" }).toSource()).toBe("\\[\nx\n\\]");
    expect(() => new InlineMathNode(String.raw`x\)y`, { format: "tex" })).toThrow(InputError);
    expect(() => new DisplayMathNode(String.raw`x\]y`, { format: "tex" })).toThrow(InputError);
  });

  it("clears dollar metadata when changing a display node to TeX", () => {
    const dollar = new DisplayMathNode("x", { format: "dollar", meta: "equation" });
    const tex = dollar.with({ format: "tex" });

    expect(tex).toMatchObject({ format: "tex", meta: undefined, value: "x" });
    expect(() => dollar.with({ format: "tex", meta: "equation" })).toThrow(InputError);
  });

  it("exports closed format and mode types", () => {
    expectTypeOf<MathFormat>().toEqualTypeOf<"dollar" | "tex">();
    expectTypeOf<MathMode>().toEqualTypeOf<"auto" | MathFormat>();
    expectTypeOf<{ math: true }>().not.toMatchTypeOf<SyntaxOptions>();
  });
});

describe("streaming TeX math", () => {
  it("publishes inline math only after its closing delimiter arrives", () => {
    const stream = new MdxStream({ syntax: { math: "tex" } });

    const pending = stream.append("\\(x").document;
    expect(renderStreamingHtml(pending)).toContain("\\(x");
    expect(streamingKinds(pending)).toContain("pendingMath");

    const committed = stream.append("\\)").document;
    expect(renderStreamingHtml(committed)).toContain(
      '<code class="language-math math-inline">x</code>',
    );
    expect(streamingKinds(committed)).toContain("math");
  });

  it("publishes display math only after its closing delimiter arrives", () => {
    const stream = new MdxStream({ syntax: { math: "tex" } });

    expect(renderStreamingHtml(stream.append("\\[\nx").document)).toContain("\\[");
    expect(renderStreamingHtml(stream.append("\n\\]").document)).toContain("x");
  });
});

function streamingKinds(document: StreamingDocument): readonly string[] {
  const kinds: string[] = [];
  const visit = (node: (typeof document.children)[number]): void => {
    kinds.push(node.kind);
    if ("children" in node) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };
  for (const child of document.children) {
    visit(child);
  }
  return kinds;
}

function expectParsed(
  outcome: ReturnType<typeof parse>,
): Extract<ReturnType<typeof parse>, { kind: "parsed" }> {
  if (outcome.kind !== "parsed") {
    throw new Error(`Expected parsed outcome, received ${outcome.kind}`);
  }
  return outcome;
}
