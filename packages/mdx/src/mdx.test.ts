import { createHighlighter } from "shiki";
import { describe, expect, it } from "vitest";

import {
  DocumentNode,
  HtmlDocumentNode,
  HtmlElementNode,
  HtmlTextNode,
  MdxStream,
  Processor,
  compile,
  parse,
  renderHtml,
  renderStreamingHtml,
  rewriteHtml,
  selectMdx,
  type MdxNode,
} from "./mod.ts";
import {
  DocumentTransformPlugin,
  SyntaxHighlightPlugin,
  createShikiHighlighter,
  parseCodeBlockMetadata,
  type DocumentTransformContext,
  type SyntaxHighlighter,
} from "./plugins/mod.ts";

function selectNodes<TKind extends MdxNode["kind"]>(root: MdxNode, kind: TKind) {
  return Array.from(selectMdx(root, kind), ({ node }) => node);
}

class TestDocumentPlugin extends DocumentTransformPlugin {
  public readonly name: string;
  private readonly apply: (
    context: DocumentTransformContext,
  ) => DocumentNode | Promise<DocumentNode>;

  public constructor(
    name: string,
    apply: (context: DocumentTransformContext) => DocumentNode | Promise<DocumentNode>,
  ) {
    super();
    this.name = name;
    this.apply = apply;
  }

  public transform(context: DocumentTransformContext): DocumentNode | Promise<DocumentNode> {
    return this.apply(context);
  }
}

describe("MDX", () => {
  it("parses prose, built-in extensions, and executable syntax through one entry point", () => {
    const source = [
      "# Hello",
      "",
      "- [x] task",
      "",
      "| a |",
      "| - |",
      "| b |",
      "",
      "<Component value={count}>text</Component>",
      "",
      "{count + 1}",
      "",
      "export const count = 1",
      "",
    ].join("\n");
    const report = expectParsed(parse(source));

    expect(report.document).toBeInstanceOf(DocumentNode);
    expect(selectNodes(report.document, "table")).toHaveLength(1);
    expect(selectNodes(report.document, "jsxFlowElement")).toHaveLength(1);
    expect(selectNodes(report.document, "blockExpression")).toHaveLength(1);
    expect(selectNodes(report.document, "esm")).toHaveLength(1);
  });

  it("enables optional syntax without selecting a language profile", () => {
    const report = expectParsed(parse("$x$\n", { syntax: { math: "dollar" } }));
    expect(report.document.children[0]?.kind).toBe("paragraph");
  });

  it("formats through nodes", () => {
    const document = expectParsed(parse("# Title\n\nText\n")).document;
    expect(expectParsed(parse(document.toSource())).document.toString()).toBe(document.toString());
  });

  it("renders executable source inertly and omits ESM", () => {
    const document = expectParsed(
      parse("<Widget>{value}</Widget>\n\nexport const value = 1\n"),
    ).document;
    const html = renderHtml(document).toHtml();
    expect(html).toContain("&lt;Widget>{value}&lt;/Widget>");
    expect(html).not.toContain("export const");
  });

  it("renders tables without whitespace in table-only containers", () => {
    const source = ["| Name | Count |", "| - | -: |", "| Alpha | 1 |"].join("\n");
    const html = renderHtml(expectParsed(parse(source)).document).toHtml();

    expect(html).toBe(
      '<table><thead><tr><th>Name</th><th align="right">Count</th></tr></thead>' +
        '<tbody><tr><td>Alpha</td><td align="right">1</td></tr></tbody></table>',
    );
  });

  it("uses the processor for configured parsing and HTML", () => {
    const processor = new Processor();
    const document = expectParsed(processor.parse("# Hello\n")).document;
    expect(document.toSource()).toBe("# Hello");
    expect(expectProcessed(processor.processSync("# Hello\n")).value.html.toHtml()).toContain(
      "<h1>Hello</h1>",
    );
    expect(compile(document).code).toContain("function Content");
  });

  it("runs plugins in the supplied order and permits duplicate names", async () => {
    const calls: string[] = [];
    const first = new TestDocumentPlugin("duplicate", ({ document }) => {
      calls.push("first");
      return document;
    });
    const second = new TestDocumentPlugin("duplicate", ({ document }) => {
      calls.push("second");
      return document;
    });
    const plugins = [first, second];
    const processor = new Processor({ documentPlugins: plugins });
    plugins.reverse();

    processor.parse("");
    expect(calls).toEqual([]);

    processor.processSync("");
    expect(calls).toEqual(["first", "second"]);

    const asyncCalls: string[] = [];
    const asyncPlugins = [
      new TestDocumentPlugin("duplicate", ({ document }) => {
        asyncCalls.push("first");
        return document;
      }),
      new TestDocumentPlugin("duplicate", ({ document }) => {
        asyncCalls.push("second");
        return document;
      }),
    ];
    const asyncProcessor = new Processor({ documentPlugins: asyncPlugins });
    asyncPlugins.reverse();

    await asyncProcessor.process("");
    expect(asyncCalls).toEqual(["first", "second"]);
  });

  it("parses typed JSON code metadata with one-based line ranges", () => {
    const result = parseCodeBlockMetadata(
      '{"fileName":"kernel.cu","highlightLines":"2,4-6","lineNumbers":{"start":20},"commandLines":"1-3","custom":42}',
    );
    expect(result.kind).toBe("parsed");
    expect(result.metadata).toMatchObject({
      fileName: "kernel.cu",
      highlightedLines: {
        kind: "ranges",
        ranges: [
          { start: 2, end: 2 },
          { start: 4, end: 6 },
        ],
      },
      commandLines: {
        kind: "ranges",
        ranges: [{ start: 1, end: 3 }],
      },
      lineNumbers: { lines: { kind: "all" }, start: 20 },
    });

    const invalid = parseCodeBlockMetadata(
      '{"highlightLines":"0,3-2","lineNumbers":{"start":0},"fileName":""}',
    );
    expect(invalid).toMatchObject({
      kind: "invalid",
      issues: [{ field: "fileName" }, { field: "highlightLines" }, { field: "lineNumbers" }],
    });
  });

  it("highlights owned code blocks with metadata, caching, and source origins", () => {
    let calls = 0;
    const highlighter = {
      highlight(request) {
        calls++;
        expect(request.metadata.fileName).toBe("same.ts");
        return new HtmlElementNode("pre", { "data-highlighted": "" }, [
          new HtmlTextNode(request.code),
        ]);
      },
      kind: "synchronous",
    } satisfies SyntaxHighlighter;
    const source = [
      '```ts {"fileName":"same.ts"}',
      "const value = 1",
      "```",
      "",
      '```ts {"fileName":"same.ts"}',
      "const value = 1",
      "```",
    ].join("\n");
    const outcome = expectProcessed(
      new Processor({ htmlPlugins: [new SyntaxHighlightPlugin({ highlighter })] }).processSync(
        source,
      ),
    );
    const blocks = outcome.value.html.children.filter(
      (node): node is HtmlElementNode =>
        node instanceof HtmlElementNode && node.attributes["data-highlighted"] === "",
    );

    expect(calls).toBe(1);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.origin).not.toEqual(blocks[1]?.origin);
    expect(blocks[0]?.origin?.file).toBe(outcome.file);
  });

  it("renders Shiki line metadata without changing the code", async () => {
    const shiki = await createHighlighter({
      langs: ["typescript"],
      themes: ["github-light", "github-dark"],
    });
    try {
      const highlighter = createShikiHighlighter(shiki, {
        includeDataAttributes: ["language", "line-count", "meta"],
        languageAliases: { ts: "typescript" },
        themes: { light: "github-light", dark: "github-dark" },
      });
      const source = [
        '```ts {"fileName":"answer.ts","highlightLines":"2","lineNumbers":{"start":8},"commandLines":"1"}',
        "const answer = 42",
        "console.log(answer)",
        "```",
      ].join("\n");
      const outcome = expectProcessed(
        new Processor({
          htmlPlugins: [new SyntaxHighlightPlugin({ highlighter })],
        }).processSync(source),
      );
      const html = outcome.value.html.toHtml();

      expect(html).toContain('data-file-name="answer.ts"');
      expect(html).toContain('data-language="ts"');
      expect(html).toContain('data-line-count="2"');
      expect(html).toContain('class="language-ts"');
      expect(html).toContain('class="line line-number line-command" data-line="8"');
      expect(html).toContain('class="line highlighted line-number" data-line="9"');
      expect(outcome.value.html.toString()).toBe("const answer = 42\nconsole.log(answer)");
    } finally {
      shiki.dispose();
    }
  });

  it("rejects invalid stream configuration", () => {
    expect(() => new MdxStream({ maximumPendingBlockLength: 0 })).toThrow(
      "Invalid stream maximumPendingBlockLength",
    );
  });

  it("publishes typed pending JSX only while streaming", () => {
    const stream = new MdxStream();
    const opening = stream.append('<Alert title="Info" ');
    const node =
      opening.document.children[0]?.kind === "jsx" ? opening.document.children[0] : undefined;

    expect(node?.name).toBe("Alert");
    expect(node?.state).toBe("pending");
    expect(node?.attributes).toEqual({ title: "Info" });
    expect(stream.complete().kind).toBe("invalid");
    expect(parse('<Alert title="Info" ').kind).toBe("invalid");
  });

  it("commits complete JSX before the stream completes", () => {
    const stream = new MdxStream();
    const snapshot = stream.append("<Alert />\n\nMore");

    expect(renderStreamingHtml(snapshot.document)).toContain("&lt;Alert /&gt;");
    expect(snapshot.blocks).toHaveLength(2);
  });

  it("preserves block identity across appends and makes completion terminal", () => {
    const stream = new MdxStream({ source: "The [manual][docs] is final.\n\n" });
    const snapshot = stream.snapshot();
    if ("kind" in snapshot) {
      throw new Error("Expected a stream snapshot");
    }
    const firstId = snapshot.blocks[0]?.id;
    expect(snapshot.blocks[0]?.dependencies.definitions).toEqual(["DOCS"]);
    expect(renderStreamingHtml(snapshot.document)).toContain("[manual][docs]");

    const appended = stream.append("[docs]: https://rabzelj.com\n\nSecond");
    expect(appended.blocks[0]?.id).toBe(firstId);
    const resolved = appended.blocks[0];
    if (resolved === undefined) {
      throw new Error("Expected the reference block");
    }
    expect(renderStreamingHtml(resolved.document)).toContain(
      '<a href="https://rabzelj.com">manual</a>',
    );

    const definitionStart = appended.file.text.indexOf("[docs]:");
    const repaired = stream.edit({
      start: definitionStart,
      end: definitionStart + "[docs]: https://rabzelj.com\n\n".length,
      text: "",
    });
    expect(repaired.blocks[0]?.id).toBe(firstId);
    const unresolved = repaired.blocks[0];
    if (unresolved === undefined) {
      throw new Error("Expected the repaired reference block");
    }
    expect(renderStreamingHtml(unresolved.document)).toContain("[manual][docs]");
    expect(stream.complete().kind).toBe("parsed");
    expect(() => stream.append("more")).toThrow("completed MdxStream is terminal");
  });

  it("reuses HTML documents only when replacement children retain identity", () => {
    const document = new HtmlDocumentNode([new HtmlTextNode("text")]);

    expect(document.with({ children: document.children })).toBe(document);
    expect(document.with({ children: [new HtmlTextNode("text")] })).not.toBe(document);
  });

  it("preserves HTML element replacements with unchanged text content", () => {
    const document = new HtmlDocumentNode([
      new HtmlElementNode("h1", {}, [new HtmlTextNode("Heading")]),
    ]);
    const rewritten = rewriteHtml(document, {
      element: ({ node }) => (node.tagName === "h1" ? node.with({ tagName: "h2" }) : node),
    });

    expect(rewritten.toHtml()).toBe("<h2>Heading</h2>");
  });
});

function expectParsed(
  outcome: ReturnType<typeof parse>,
): Extract<ReturnType<typeof parse>, { kind: "parsed" }> {
  if (outcome.kind !== "parsed") {
    throw new Error(`Expected parsed outcome, received ${outcome.kind}`);
  }
  return outcome;
}

function expectProcessed(
  outcome: ReturnType<Processor["processSync"]>,
): Extract<ReturnType<Processor["processSync"]>, { kind: "processed" }> {
  if (outcome.kind !== "processed") {
    throw new Error(`Expected processed outcome, received ${outcome.kind}`);
  }
  return outcome;
}
