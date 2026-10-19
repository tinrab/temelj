import { describe, expect, expectTypeOf, it } from "vitest";

import type { DocumentPlugin, HtmlPlugin } from "./plugins/mod.ts";

import {
  ConfigurationError,
  formatHtml,
  formatMdx,
  lowerHtml,
  parse,
  Processor,
  selectHtml,
  selectMdx,
  TransformError,
  type HeadingNode,
  type HtmlElementNode,
  type MdxNode,
  type ParseOptions,
  type ProcessResult,
} from "./mod.ts";
import { HeadingIdPlugin, MathRenderPlugin, RemoveEsmPlugin } from "./plugins/mod.ts";

describe("formatter round trip", () => {
  const fixtures: ReadonlyArray<readonly [string, ParseOptions]> = [
    ['# Title\n\nSome *emphasis*, **strong**, `code`, and [a link](https://x.test "t").', {}],
    ["- one\n- two\n\n  continued\n- three\n\n1. a\n2. b", {}],
    ["> Quote\n>\n> - nested", {}],
    ["```ts\nconst a = 1;\n```\n\n---\n\n    indented", {}],
    ["| a | b |\n| :- | -: |\n| 1 | 2 |", {}],
    ["See [ref][r] and [^note].\n\n[r]: /r\n\n[^note]: Footnote.", {}],
    ['<Note title="x">\n# Inside\n\n- item\n</Note>\n\n{1 + 1}', {}],
    [":::note[Label]{#id}\nBody\n:::", { syntax: { directives: true } }],
    ["$a$ and\n\n$$\nb\n$$", { syntax: { math: "dollar" } }],
  ];

  it.each(fixtures)("reparses formatted %j to the same tree", (source, options) => {
    const first = parse(source, options).document;
    const formatted = formatMdx(first, options);
    const second = parse(formatted, options).document;

    expect(withoutOrigins(second)).toBe(withoutOrigins(first));
    expect(formatMdx(second, options)).toBe(formatted);
  });
});

describe("parser limits", () => {
  it("reports an exceeded source length", () => {
    expect(() => parse("x".repeat(20), { limits: { maximumSourceLength: 10 } })).toThrow(
      expect.objectContaining({ limit: "maximumSourceLength" }),
    );
  });

  it("reports exceeded nesting depth", () => {
    expect(() => parse("> ".repeat(20) + "deep", { limits: { maximumNestingDepth: 5 } })).toThrow(
      expect.objectContaining({ limit: "maximumNestingDepth" }),
    );
  });

  it("reports an exceeded node count", () => {
    expect(() => parse("*a* ".repeat(50), { limits: { maximumNodes: 20 } })).toThrow(
      expect.objectContaining({ limit: "maximumNodes" }),
    );
  });

  it("rejects invalid limit configuration", () => {
    expect(() => parse("x", { limits: { maximumNodes: 0 } })).toThrow(ConfigurationError);
  });
});

describe("plugin runner", () => {
  const renamed: DocumentPlugin = {
    name: "rename",
    transform: (context) =>
      context.rewrite({ text: ({ node }) => ({ ...node, value: "changed" }) }),
  };

  it("stops at a plugin that reports an error diagnostic", () => {
    const failing: DocumentPlugin = {
      name: "failing",
      transform: (context) => {
        context.diagnostics.add({ code: "test", message: "failed", severity: "error" });

        return context.rewrite({ text: ({ node }) => ({ ...node, value: "lost" }) });
      },
    };

    expect(() =>
      new Processor({ documentPlugins: [renamed, failing] }).processSync("text"),
    ).toThrow(
      expect.objectContaining({
        issue: { kind: "reported", target: "document", pluginName: "failing" },
        diagnostics: [expect.objectContaining({ code: "test" })],
      }),
    );
  });

  it("wraps plugin exceptions with the stage and plugin name", () => {
    const throwing: HtmlPlugin = {
      name: "throwing",
      transform: () => {
        throw new Error("boom");
      },
    };

    const run = (): ProcessResult => new Processor({ htmlPlugins: [throwing] }).processSync("text");

    expect(run).toThrow(TransformError);
    expect(run).toThrow('Plugin "throwing" failed while transforming html');
  });

  it("rejects asynchronous plugins in synchronous processing", async () => {
    const asynchronous: DocumentPlugin = {
      name: "asynchronous",
      transform: async (context) => context.document,
    };

    const processor = new Processor({ documentPlugins: [asynchronous, renamed] });

    expect(() => processor.processSync("text")).toThrow(ConfigurationError);

    const outcome = await processor.process("text");
    expect(formatMdx(outcome.document)).toBe("changed");
  });

  it("stops at an aborted signal", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stopped"));

    await expect(new Processor().process("text", { signal: controller.signal })).rejects.toThrow(
      "stopped",
    );
  });
});

describe("built-in plugins", () => {
  it("adds unique heading IDs without replacing authored IDs", () => {
    const outcome = new Processor({
      htmlPlugins: [new HeadingIdPlugin({ prefix: "" })],
    }).processSync("# Same\n\n## Same\n\n### Other");

    const ids = [...selectHtml(outcome.html, "element")].flatMap(({ node }) =>
      node.attributes.id === undefined ? [] : [node.attributes.id],
    );

    expect(ids).toEqual(["same", "same-1", "other"]);
  });

  it("removes ESM from the semantic tree", () => {
    const outcome = new Processor({ documentPlugins: [new RemoveEsmPlugin()] }).processSync(
      "export const a = 1\n\n# Title",
    );

    expect(outcome.document.children.map((node) => node.kind)).toEqual(["heading"]);
  });

  it("renders math and reports tolerant failures as warnings", () => {
    const rendered: HtmlElementNode = {
      kind: "element",
      tagName: "span",
      attributes: { class: "rendered" },
      children: [],
    };

    const renderer = {
      render: ({ node }: { readonly node: { readonly source: string } }) => {
        if (node.source === "bad") {
          throw new Error("invalid");
        }

        return rendered;
      },
    };

    const processor = new Processor({
      syntax: { math: "dollar" },
      htmlPlugins: [new MathRenderPlugin({ renderer })],
    });

    const outcome = processor.processSync("$good$ and $bad$");

    expect(formatHtml(outcome.html)).toContain('class="rendered"');
    expect(outcome.diagnostics.map((diagnostic) => diagnostic.severity)).toEqual(["warning"]);

    const strict = new Processor({
      syntax: { math: "dollar" },
      htmlPlugins: [new MathRenderPlugin({ renderer, mode: "strict" })],
    });

    expect(() => strict.processSync("$bad$")).toThrow(TransformError);
  });
});

describe("public types", () => {
  it("narrows selected nodes by kind", () => {
    const document = parse("# Title").document;
    const html = lowerHtml(document);

    for (const { node } of selectMdx(document, "heading")) {
      expectTypeOf(node).toEqualTypeOf<HeadingNode>();
    }

    for (const { node } of selectHtml(html, "element")) {
      expectTypeOf(node).toEqualTypeOf<HtmlElementNode>();
    }
  });
});

/** Trees compare structurally when source ranges are ignored. */
function withoutOrigins(node: MdxNode): string {
  return JSON.stringify(node, (key, value) =>
    key === "origin" || key === "valueOrigin" ? undefined : value,
  );
}
