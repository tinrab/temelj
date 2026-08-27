import { describe, expect, it } from "vitest";

import {
  DefinitionNode,
  DocumentNode,
  DocumentTransformPlugin,
  HtmlDocumentNode,
  HtmlTransformPlugin,
  ImageReferenceNode,
  Processor,
  parse,
  renderHtml,
  rewriteHtml,
  rewriteMdx,
  selectHtml,
  selectMdx,
  type DocumentTransformContext,
  type HtmlTransformContext,
} from "./mod.ts";

class TestDocumentPlugin extends DocumentTransformPlugin {
  public readonly name: string;
  private readonly apply: (context: DocumentTransformContext) => DocumentNode;

  public constructor(name: string, apply: (context: DocumentTransformContext) => DocumentNode) {
    super();
    this.name = name;
    this.apply = apply;
  }

  public transform(context: DocumentTransformContext): DocumentNode {
    return this.apply(context);
  }
}

class TestHtmlPlugin extends HtmlTransformPlugin {
  public readonly name: string;
  private readonly apply: (
    context: HtmlTransformContext,
  ) => HtmlDocumentNode | Promise<HtmlDocumentNode>;

  public constructor(
    name: string,
    apply: (context: HtmlTransformContext) => HtmlDocumentNode | Promise<HtmlDocumentNode>,
  ) {
    super();
    this.name = name;
    this.apply = apply;
  }

  public transform(context: HtmlTransformContext): HtmlDocumentNode | Promise<HtmlDocumentNode> {
    return this.apply(context);
  }
}

describe("owned tree traversal", () => {
  it("keeps property-only replacements in nested MDX nodes", () => {
    const document = expectParsed(parse("![alt](before.png)\n")).document;
    const rewritten = rewriteMdx(document, {
      image: ({ node }) => node.with({ url: "after.webp" }),
    });

    expect(rewritten).not.toBe(document);
    expect(renderHtml(rewritten).toHtml()).toContain('src="after.webp"');
  });

  it("supports a collect, process, and rewrite image workflow", async () => {
    const document = expectParsed(
      parse(
        '![direct](photo.png "direct title")\n\n![reference][photo]\n\n[photo]: photo.png "reference title"\n',
      ),
    ).document;
    const reference = [...selectMdx(document, "imageReference")][0]?.node;
    expect(reference).toBeDefined();
    expect(document.definition(reference?.identifier ?? "")?.url).toBe("photo.png");

    const html = renderHtml(document);
    const images = [...selectHtml(html, "element")]
      .map(({ node }) => node)
      .filter((node) => node.tagName === "img" && typeof node.attributes.src === "string");
    const processed = new Map<
      string,
      Readonly<{ height: number; src: string; srcset: string; width: number }>
    >();
    let calls = 0;
    await Promise.all(
      [...new Set(images.map((image) => String(image.attributes.src)))].map(async (source) => {
        calls++;
        await Promise.resolve();
        processed.set(source, {
          height: 600,
          src: "photo.webp",
          srcset: "photo.webp 1x, photo@2x.webp 2x",
          width: 800,
        });
      }),
    );
    const optimized = rewriteHtml(html, {
      element: ({ node }) => {
        const source = node.attributes.src;
        const result = typeof source === "string" ? processed.get(source) : undefined;
        return result === undefined
          ? undefined
          : node.with({ attributes: { ...node.attributes, ...result } });
      },
    });

    expect(calls).toBe(1);
    expect(optimized.toHtml()).toContain(
      'src="photo.webp" alt="direct" title="direct title" height="600"',
    );
    expect(optimized.toHtml()).toContain('srcset="photo.webp 1x, photo@2x.webp 2x"');
    expect(optimized.toHtml()).toContain('alt="reference" title="reference title"');
  });

  it("edits definitions and image references without losing normalization", () => {
    const definition = new DefinitionNode("Photo", "before.png");
    const reference = new ImageReferenceNode("Photo", "before");

    expect(definition.with({ identifier: " PHOTO ", url: "after.webp" })).toMatchObject({
      identifier: "PHOTO",
      url: "after.webp",
    });
    expect(reference.with({ identifier: " PHOTO ", alt: "after" })).toMatchObject({
      identifier: "PHOTO",
      alt: "after",
    });
  });

  it("threads document diagnostics into HTML reports", () => {
    const processor = new Processor({
      documentPlugins: [
        new TestDocumentPlugin("document-diagnostics", ({ diagnostics, document }) => {
          diagnostics.add({ code: "document", message: "document", severity: "warning" });
          return document;
        }),
      ],
      htmlPlugins: [
        new TestHtmlPlugin("html-diagnostics", ({ diagnostics, document }) => {
          diagnostics.add({ code: "html", message: "html", severity: "warning" });
          return document;
        }),
      ],
    });
    const htmlReport = processor.processSync("text");

    expect(htmlReport.diagnostics.map(({ code }) => code)).toEqual(["document", "html"]);
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
