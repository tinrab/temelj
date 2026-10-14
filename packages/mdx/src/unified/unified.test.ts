import type { Plugin, Preset } from "unified";

import rehypeShikiFromHighlighter from "@shikijs/rehype/core";
import { isString } from "@temelj/value";
import rehypeSlug from "rehype-slug";
import remarkToc from "remark-toc";
import { createHighlighter } from "shiki";
import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  DocumentPlugin,
  DocumentPluginContext,
  HtmlPlugin,
  HtmlPluginContext,
} from "../plugins/mod.ts";

import {
  ConfigurationError,
  formatHtml,
  formatMdx,
  htmlText,
  nodeText,
  Processor,
} from "../mod.ts";
import { RehypePluginAdapter, RemarkPluginAdapter } from "./mod.ts";

declare module "unified" {
  interface Data {
    "shared-setting"?: string;
  }
}

interface TestNode {
  readonly type: string;
  children?: TestNode[];
  value?: string;
}

interface TestRoot extends TestNode {
  readonly type: "root";
  children: TestNode[];
}

const highlighter = await createHighlighter({
  langs: ["text", "typescript"],
  themes: ["github-light", "github-dark"],
});

class NativeTextPlugin implements DocumentPlugin {
  public readonly name = "native";

  public transform(context: DocumentPluginContext) {
    return context.rewrite({ text: ({ node }) => ({ ...node, value: `${node.value}!` }) });
  }
}

class NativeHtmlTextPlugin implements HtmlPlugin {
  public readonly name = "native-html";

  public transform(context: HtmlPluginContext) {
    return context.rewrite({
      text: ({ node }) => ({ ...node, value: `${node.value}!` }),
    });
  }
}

describe("Unified plugin adapters", () => {
  it("runs remark and rehype transforms in their declared stages", () => {
    const processor = new Processor({
      documentPlugins: [new RemarkPluginAdapter(remarkToc)],
      htmlPlugins: [new RehypePluginAdapter(rehypeSlug)],
    });

    const result = processed(processor.processSync("# Table of contents\n\n# Alpha\n\n## Beta\n"));

    expect(formatMdx(result.document)).toContain("- [Alpha](#alpha)");
    expect(result.htmlString).toContain('<h1 id="alpha">Alpha</h1>');
    expect(result.htmlString).toContain('<a href="#beta">Beta</a>');
  });

  it("supports options, mutation, root replacement, callbacks, and promises", async () => {
    const replace: Plugin<[{ value: string }], TestRoot, TestRoot> = (options) => () => ({
      type: "root",
      children: [{ type: "paragraph", children: [{ type: "text", value: options.value }] }],
    });

    const callback: Plugin<[], TestRoot, TestRoot> = () => (tree, _file, done) => {
      const paragraph = tree.children[0];

      if (paragraph?.type === "paragraph") {
        paragraph.children?.push({ type: "text", value: " callback" });
      }

      done();
    };

    const promise: Plugin<[], TestRoot, TestRoot> = () => async (tree) => {
      await Promise.resolve();

      return tree;
    };

    const processor = new Processor({
      documentPlugins: [
        new RemarkPluginAdapter(replace, { value: "replacement" }),
        new RemarkPluginAdapter(callback),
      ],
      htmlPlugins: [new RehypePluginAdapter(promise)],
    });

    await expect(processor.process("ignored")).resolves.toMatchObject({
      document: { children: [{ children: [{ value: "replacement" }, { value: " callback" }] }] },
    });
    expect(() => processor.processSync("ignored")).toThrow(ConfigurationError);
  });

  it("accepts Unified presets", () => {
    const append: Plugin<[string], TestRoot, TestRoot> = (suffix) => (tree) => {
      const paragraph = tree.children[0];
      const text = paragraph?.type === "paragraph" ? paragraph.children?.[0] : undefined;

      if (text?.type === "text" && isString(text.value)) {
        text.value += suffix;
      }
    };

    const preset: Preset = { plugins: [[append, " preset"]] };

    const result = processed(
      new Processor({
        documentPlugins: [new RemarkPluginAdapter(preset)],
      }).processSync("value"),
    );

    expect(nodeText(result.document)).toBe("value preset");
  });

  it("groups plugins with presets and converts messages", () => {
    const setProcessorData: Plugin<[], TestRoot, TestRoot> = function () {
      this.data("shared-setting", "ready");
    };

    const useProcessorData: Plugin<[], TestRoot, TestRoot> = function () {
      const setting = this.data("shared-setting");

      return (tree, file) => {
        file.data.stageValue = setting;
        file.info("remark note", { line: 1, column: 1, offset: 0 }, "fixture:remark");

        return tree;
      };
    };

    const rehypeMessage: Plugin<[], TestRoot, TestRoot> = () => (tree, file) => {
      file.message("rehype note");

      return tree;
    };

    const preset: Preset = { plugins: [setProcessorData, useProcessorData] };

    const report = new Processor({
      documentPlugins: [new RemarkPluginAdapter(preset)],
      htmlPlugins: [new RehypePluginAdapter(rehypeMessage)],
    }).processSync("text");

    expect(report.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "remark note",
      "rehype note",
    ]);
    expect(report.diagnostics[0]?.span).toMatchObject({ start: 0, end: 0 });
    expect(report.diagnostics[0]?.notes).toEqual(["source: fixture", "rule: remark"]);
  });

  it("maps CRLF and UTF-16 message offsets to the original source", () => {
    const position: Plugin<[], TestRoot, TestRoot> = () => (tree, file) => {
      file.message("emoji", {
        start: { line: 2, column: 1, offset: 3 },
        end: { line: 2, column: 3, offset: 5 },
      });

      return tree;
    };

    const report = new Processor({
      documentPlugins: [new RemarkPluginAdapter(position)],
    }).processSync("a\r\n😀b");

    const span = report.diagnostics[0]?.span;

    expect(span).toMatchObject({ start: 3, end: 5 });
    expect(span?.file.location(span.end)).toEqual({ offset: 5, line: 2, column: 3 });
  });

  it("keeps native plugins ordered with external plugins", () => {
    const observe: Plugin<[], TestRoot, TestRoot> = () => (tree) => {
      const paragraph = tree.children[0];
      const text = paragraph?.type === "paragraph" ? paragraph.children?.[0] : undefined;

      if (text?.type === "text" && isString(text.value)) {
        text.value += "?";
      }
    };

    const result = processed(
      new Processor({
        documentPlugins: [new NativeTextPlugin(), new RemarkPluginAdapter(observe)],
      }).processSync("order"),
    );

    expect(nodeText(result.document)).toBe("order!?");
  });

  it("keeps external and native HTML plugins in declared order", () => {
    const external: Plugin<[], TestRoot, TestRoot> = () => (tree) => {
      const paragraph = tree.children[0];
      const text = paragraph?.type === "element" ? paragraph.children?.[0] : undefined;

      if (text?.type === "text" && isString(text.value)) {
        text.value += "?";
      }
    };

    const result = processed(
      new Processor({
        htmlPlugins: [new RehypePluginAdapter(external), new NativeHtmlTextPlugin()],
      }).processSync("order"),
    );

    expect(htmlText(result.html)).toBe("order?!");
  });

  it("normalizes HTML and SVG properties without losing data or ARIA names", () => {
    const properties: Plugin<[], TestRoot, TestRoot> = () => () => ({
      type: "root",
      children: [
        {
          type: "element",
          tagName: "svg",
          properties: {
            ariaLabel: "chart",
            className: ["plot"],
            dataTheme: "dark",
            viewBox: "0 0 10 10",
          },
          children: [
            {
              type: "element",
              tagName: "path",
              properties: { strokeLineCap: "round", strokeWidth: 2 },
              children: [],
            },
          ],
        },
      ],
    });

    const html = processed(
      new Processor({
        htmlPlugins: [new RehypePluginAdapter(properties)],
      }).processSync("text"),
    ).htmlString;

    expect(html).toBe(
      '<svg aria-label="chart" class="plot" data-theme="dark" viewBox="0 0 10 10"><path stroke-linecap="round" stroke-width="2"></path></svg>',
    );
  });

  it("runs a preloaded Shiki highlighter synchronously with dual-theme output", () => {
    const shiki = () =>
      rehypeShikiFromHighlighter(highlighter, {
        addLanguageClass: true,
        themes: { light: "github-light", dark: "github-dark" },
      });

    const processor = new Processor({
      htmlPlugins: [new RehypePluginAdapter(shiki)],
    });

    const highlighted = processed(
      processor.processSync("```ts\nconst answer = 42\n```"),
    ).htmlString;

    const fallback = processed(processor.processSync("```unknown\nplain text\n```")).htmlString;

    const math = processed(
      new Processor({
        htmlPlugins: [new RehypePluginAdapter(shiki)],
        syntax: { math: "dollar" },
      }).processSync("$$ equation\nx^2\n$$"),
    ).htmlString;

    expect(highlighted).toContain('<pre class="shiki shiki-themes github-light github-dark"');
    expect(highlighted).toContain('<code class="language-ts"');
    expect(highlighted).toContain('<span class="line"><span style=');
    expect(highlighted).toContain("--shiki-dark");
    expect(fallback).toBe('<pre><code class="language-unknown">plain text\n</code></pre>');
    expect(math).toBe(
      '<pre data-math-meta="equation"><code class="language-math math-display">x^2\n</code></pre>',
    );
  });

  it("rejects custom final nodes and cyclic trees", () => {
    const custom: Plugin<[], TestRoot, TestRoot> = () => (tree) => {
      Reflect.set(tree, "children", [{ type: "custom" }]);
    };

    const cyclic: Plugin<[], TestRoot, TestRoot> = () => (tree) => {
      Reflect.set(tree, "children", [tree]);
    };

    expect(() =>
      new Processor({
        documentPlugins: [new RemarkPluginAdapter(custom)],
      }).processSync("text"),
    ).toThrow("failed while transforming document");
    expect(() =>
      new Processor({
        documentPlugins: [new RemarkPluginAdapter(cyclic)],
      }).processSync("text"),
    ).toThrow("failed while transforming document");
  });

  it("rolls back a stage after a fatal VFile message", () => {
    const fatal: Plugin<[], TestRoot, TestRoot> = () => (tree, file) => {
      tree.children = [];
      file.fail("stop here");
    };

    const report = new Processor({
      documentPlugins: [new RemarkPluginAdapter(fatal)],
    }).processSync("original");

    expect(nodeText(processed(report).document)).toBe("original");
    expect(report.diagnostics).toMatchObject([
      { code: "mdx.plugin.unified", message: "stop here", severity: "error" },
    ]);
  });

  it("round-trips owned extension nodes through a remark stage", () => {
    const noop: Plugin<[], TestRoot, TestRoot> = () => {};

    const source = [
      "---",
      "title: Fixture",
      "---",
      "",
      "export const value = 1",
      "",
      "# **Heading**",
      "",
      "> quote with ~~delete~~, `code`, [link](https://rabzelj.com), and $x$.",
      "",
      "- [x] task",
      "",
      "| A | B |",
      "| :- | -: |",
      "| 1 | 2 |",
      "",
      ":badge[label]{state=ready}",
      "",
      ":::note[Label]{tone=info}",
      "Body",
      ":::",
      "",
      "<Widget enabled value={value}>child</Widget>",
      "",
      "{value}",
      "",
      "$$",
      "y",
      "$$",
    ].join("\n");

    const result = processed(
      new Processor({
        syntax: { directives: true, frontmatter: "yaml", math: "dollar" },
        documentPlugins: [new RemarkPluginAdapter(noop)],
      }).processSync(source),
    );

    expect(nodeText(result.document)).toContain("Heading");
    expect(formatMdx(result.document)).toContain(':::note[Label]{tone="info"}');
    expect(result.htmlString).toContain("language-math");
  });

  it("rejects parser and compiler plugins at the adapter boundary", () => {
    const parser: Plugin<[], string, TestRoot> = function () {
      this.parser = () => ({ type: "root", children: [] });
    };

    const compiler: Plugin<[], TestRoot, string> = function () {
      this.compiler = () => "html";
    };

    expect(() =>
      new Processor({
        documentPlugins: [new RemarkPluginAdapter(parser)],
      }).processSync(""),
    ).toThrow(ConfigurationError);
    expect(() =>
      new Processor({
        htmlPlugins: [new RehypePluginAdapter(compiler)],
      }).processSync(""),
    ).toThrow(ConfigurationError);
  });

  it("uses stage-specific plugin contracts", () => {
    function rejectInvalidTypes(): void {
      const lookalike = { name: "lookalike" };
      // @ts-expect-error Structural objects are not document plugins.
      new Processor({ documentPlugins: [lookalike] });
      // @ts-expect-error Rehype adapters belong to the HTML stage.
      new Processor({ documentPlugins: [new RehypePluginAdapter(rehypeSlug)] });
      // @ts-expect-error Unified presets do not accept plugin parameters.
      new RemarkPluginAdapter({ plugins: [] }, "option");
    }

    expectTypeOf(rejectInvalidTypes).toBeFunction();
  });
});

function processed(outcome: ReturnType<Processor["processSync"]>) {
  if (outcome.kind !== "ok") {
    throw new Error(`Expected processed outcome, received ${outcome.kind}`);
  }

  return { ...outcome, htmlString: formatHtml(outcome.html) };
}
