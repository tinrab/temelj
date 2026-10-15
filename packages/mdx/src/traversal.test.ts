import { isString } from "@temelj/value";
import { describe, expect, it } from "vitest";

import type { DocumentPlugin, HtmlPlugin } from "./plugins/mod.ts";

import {
  formatHtml,
  formatMdx,
  indexDocument,
  lowerHtml,
  parse,
  Processor,
  rewriteHtml,
  rewriteMdx,
  selectHtml,
  selectMdx,
} from "./mod.ts";

describe("tree traversal", () => {
  it("keeps property-only replacements in nested MDX nodes", () => {
    const document = parse("![alt](before.png)\n").document;

    const rewritten = rewriteMdx(document, {
      image: ({ node }) => ({ ...node, url: "after.webp" }),
    });

    expect(rewritten).not.toBe(document);
    expect(formatHtml(lowerHtml(rewritten))).toContain('src="after.webp"');
  });

  it("returns the original tree when nothing changes", () => {
    const document = parse("# Title\n\n- a\n- b\n").document;

    expect(rewriteMdx(document, { text: () => {} })).toBe(document);
  });

  it("removes nodes when a handler returns null", () => {
    const document = parse("one\n\n---\n\ntwo\n").document;
    const rewritten = rewriteMdx(document, { thematicBreak: () => null });

    expect(rewritten.children.map((node) => node.kind)).toEqual(["paragraph", "paragraph"]);
  });

  it("replaces MDX nodes within the same content category", () => {
    const document = parse("Use `code` here.\n\n---\n").document;

    const rewritten = rewriteMdx(document, {
      inlineCode: ({ node }) => ({
        kind: "strong",
        children: [{ kind: "text", value: node.value }],
      }),
      thematicBreak: () => ({ kind: "paragraph", children: [{ kind: "text", value: "break" }] }),
    });

    expect(formatMdx(rewritten)).toBe("Use **code** here.\n\nbreak");
    expect(() =>
      rewriteMdx(document, {
        // @ts-expect-error A phrasing node cannot be replaced with flow content.
        inlineCode: () => ({ kind: "thematicBreak" }),
      }),
    ).toThrow("A inlineCode rewrite handler returned a thematicBreak node");
  });

  it("replaces HTML nodes with a different kind", () => {
    const html = lowerHtml(parse("```ts\nconst a = 1;\n```\n").document);

    const rewritten = rewriteHtml(html, {
      codeBlock: ({ node }) => ({ kind: "raw", value: `<pre>${node.code}</pre>` }),
    });

    expect(formatHtml(rewritten, { rawHtml: "trusted" })).toBe("<pre>const a = 1;</pre>");
  });

  it("supports a collect, process, and rewrite image workflow", async () => {
    const document = parse(
      '![direct](photo.png "direct title")\n\n![reference][photo]\n\n[photo]: photo.png "reference title"\n',
    ).document;

    const reference = [...selectMdx(document, "imageReference")][0]?.node;
    expect(reference).toBeDefined();
    expect(indexDocument(document).definitions.get(reference?.identifier ?? "")?.url).toBe(
      "photo.png",
    );

    const html = lowerHtml(document);

    const images = [...selectHtml(html, "element")].flatMap(({ node }) =>
      node.tagName === "img" && isString(node.attributes.src) ? [node] : [],
    );

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
        const result = isString(source) ? processed.get(source) : undefined;

        return result === undefined
          ? undefined
          : { ...node, attributes: { ...node.attributes, ...result } };
      },
    });

    const output = formatHtml(optimized);
    expect(calls).toBe(1);
    expect(output).toContain('src="photo.webp" alt="direct" title="direct title" height="600"');
    expect(output).toContain('srcset="photo.webp 1x, photo@2x.webp 2x"');
    expect(output).toContain('alt="reference" title="reference title"');
  });

  it("threads document diagnostics into HTML reports", () => {
    const documentPlugin: DocumentPlugin = {
      name: "document-diagnostics",
      transform: ({ diagnostics, document }) => {
        diagnostics.add({ code: "document", message: "document", severity: "warning" });

        return document;
      },
    };

    const htmlPlugin: HtmlPlugin = {
      name: "html-diagnostics",
      transform: ({ diagnostics, root }) => {
        diagnostics.add({ code: "html", message: "html", severity: "warning" });

        return root;
      },
    };

    const processor = new Processor({
      documentPlugins: [documentPlugin],
      htmlPlugins: [htmlPlugin],
    });

    const report = processor.processSync("text");

    expect(report.diagnostics.map(({ code }) => code)).toEqual(["document", "html"]);
  });
});
