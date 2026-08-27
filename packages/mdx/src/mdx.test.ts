import { describe, expect, it } from "vitest";

import {
  DocumentNode,
  DocumentTransformPlugin,
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
  type DocumentTransformContext,
  type MdxNode,
} from "./mod.ts";

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
