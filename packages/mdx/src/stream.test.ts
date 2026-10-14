import { describe, expect, it, vi } from "vitest";

import {
  formatHtml,
  MdxStream,
  parse,
  lowerHtml,
  renderStreamingHtml,
  type MdxStreamSnapshot,
} from "./mod.ts";
import * as inlineParser from "./parser/inline-parser.ts";
import * as materializer from "./parser/materialize.ts";

function preview(source: string): MdxStreamSnapshot {
  const snapshot = new MdxStream({ source }).snapshot();

  if (snapshot.kind !== "preview") {
    throw new Error("A new stream must be open");
  }

  return snapshot;
}

describe("streaming regressions", () => {
  it.each(["**", "_", "~~"])("filters destinations inside pending %s", (marker) => {
    for (const target of [
      "javascript:alert(1)",
      "data:text/html,hello",
      "jAvAsCrIpT:alert(1)",
      "javascript%3Aalert(1)",
    ]) {
      for (const image of ["", "!"]) {
        const source = `${marker}${image}[label](${target})`;

        for (let end = 1; end <= source.length; end++) {
          expect(renderStreamingHtml(preview(source.slice(0, end)).document)).not.toMatch(
            /(?:href|src)="(?:javascript|data)/iu,
          );
        }
      }
    }
  });

  it.each([
    ["> **bold", "<blockquote>\n<p><strong>bold</strong></p>\n</blockquote>"],
    ["- **bold", "<ul>\n<li><strong>bold</strong></li>\n</ul>"],
    [
      "> intro\n>\n> ```js\n> x",
      '<blockquote>\n<p>intro</p>\n<pre><code class="language-js">x</code></pre>\n</blockquote>',
    ],
  ])("preserves containers for %s", (source, expected) => {
    expect(renderStreamingHtml(preview(source).document)).toBe(expected);
  });

  it("publishes only committed JSX attributes", () => {
    const source = '<Alert title="Hello world" disabled >child words';

    for (let end = 1; end <= source.length; end++) {
      const node = preview(source.slice(0, end)).document.children[0];

      if (node?.kind !== "jsx") {
        continue;
      }

      expect(node.name).toBe(end < 7 ? undefined : "Alert");
      expect(node.attributes).not.toHaveProperty("world");
      expect(node.attributes).not.toHaveProperty("words");
      expect(node.attributes.title).toBe(end < 26 ? undefined : "Hello world");
      expect(node.attributes.disabled).toBe(end < 37 ? undefined : true);
    }
  });

  it("updates footnote ordinals after an equal-length edit", () => {
    const stream = new MdxStream({ source: "AAAAAA\n\nSecond[^b].\n\n[^a]: Alpha\n\n[^b]: Bravo" });
    const updated = stream.edit({ start: 0, end: 6, text: "x[^a]." });
    expect(renderStreamingHtml(updated.document)).toBe(
      renderStreamingHtml(preview(updated.file.text).document),
    );
  });

  it("retains settled rendered blocks across appends", () => {
    const stream = new MdxStream();
    const before = stream.append("# Settled\n\nTail");
    const after = stream.append(".\n\nNext");
    expect(after.blocks[0].document).toBe(before.blocks[0].document);
  });

  it("serializes void and boolean attributes consistently", () => {
    const source = "- [x] Done\n- [ ] Pending\n\n![alt](/image)\n\n---";
    const snapshot = preview(source);
    const parsed = parse(source);

    if (parsed.kind !== "ok") {
      throw new Error("Expected valid fixture");
    }

    expect(renderStreamingHtml(snapshot.document)).toBe(formatHtml(lowerHtml(parsed.document)));
  });
});

describe("stream cache validity", () => {
  it("recovers from invalid edits without reusing stale source", () => {
    const stream = new MdxStream({ source: "old\n\nend" });
    const invalid = stream.edit({ start: 0, end: 8, text: "new\n\n<A></B>" });
    expect(invalid.status).toBe("invalid");
    const start = invalid.file.text.indexOf("B");
    const repaired = stream.edit({ start, end: start + 1, text: "A" });
    expect(renderStreamingHtml(repaired.document)).toBe(
      renderStreamingHtml(preview(repaired.file.text).document),
    );
  });

  it("refreshes footnote ranges when an identical later definition wins", () => {
    const stream = new MdxStream({ source: "A[^x].\n\n[^x]: same\n\n[^x]: same\n\nend" });
    const previous = stream.append("");
    const next = stream.edit({ start: 8, end: 13, text: "plain" });
    expect(next.supplement).not.toBe(previous.supplement);
    expect(next.supplement).toEqual(preview(next.file.text).supplement);
  });

  it("refreshes link definitions inside footnotes", () => {
    const source = "A[^x].\n\n[^x]: [link][g]\n\n[g]: /old";
    const stream = new MdxStream({ source });
    const start = source.indexOf("/old");
    const next = stream.edit({ start, end: start + 4, text: "/new" });
    expect(renderStreamingHtml(next.document)).toBe(
      renderStreamingHtml(preview(next.file.text).document),
    );
  });

  it("preserves authored JSX attribute values through completion", () => {
    const node = preview('<A x="&copy;" ').document.children[0];
    expect(node?.kind).toBe("jsx");

    if (node?.kind !== "jsx") {
      throw new Error("Expected pending JSX");
    }

    expect(node.attributes).toEqual({ x: "&copy;" });
  });

  it.each([1, 3, 8, 32])("matches fresh snapshots with %i-character chunks and edits", (size) => {
    const source =
      '# Heading\n\n> - one\n> - **two**\n\nRead[^a] and [guide][g].\n\n[^a]: note\n\n[g]: /guide\n\n<Alert title="hello">child</Alert>\n';

    const stream = new MdxStream();

    for (let offset = 0; offset < source.length; offset += size) {
      const snapshot = stream.append(source.slice(offset, offset + size));
      expect(renderStreamingHtml(snapshot.document)).toBe(
        renderStreamingHtml(preview(snapshot.file.text).document),
      );
    }

    for (const edit of [
      { start: 0, end: 0, text: "Intro\n\n" },
      { start: 10, end: 17, text: "Changed" },
      { start: 0, end: 7, text: "" },
    ]) {
      const snapshot = stream.edit(edit);
      expect(renderStreamingHtml(snapshot.document)).toBe(
        renderStreamingHtml(preview(snapshot.file.text).document),
      );
    }

    const final = stream.complete();
    const batch = parse(final.file);
    expect(final.kind).toBe("ok");

    if (final.kind !== "ok" || batch.kind !== "ok") {
      throw new Error("Expected parsed completion");
    }

    expect(formatHtml(lowerHtml(final.document))).toBe(formatHtml(lowerHtml(batch.document)));
  });

  it("enforces node limits across retained and newly materialized blocks", () => {
    const stream = new MdxStream({ limits: { maximumNodes: 5 } });
    expect(stream.append("one\n\n").status).toBe("valid");
    expect(stream.append("two\n\n").status).toBe("valid");
    expect(stream.append("three").status).toBe("limitExceeded");
    const repaired = stream.edit({ start: 0, end: 15, text: "new" });
    expect(repaired.status).toBe("valid");
    expect(renderStreamingHtml(repaired.document)).toBe("<p>new</p>");
  });

  it("keeps prior snapshots unchanged after shifted edits", () => {
    const stream = new MdxStream({ source: "# First\n\nSecond[^a].\n\n[^a]: note" });
    const before = stream.append("");
    const html = renderStreamingHtml(before.document);
    const blocks = before.blocks.map((block) => ({ ...block.range }));
    stream.edit({ start: 0, end: 0, text: "Intro\n\n" });
    expect(before.file.text).toBe("# First\n\nSecond[^a].\n\n[^a]: note");
    expect(before.blocks.map((block) => block.range)).toEqual(blocks);
    expect(renderStreamingHtml(before.document)).toBe(html);
  });
});

it("does not rematerialize settled headings on append", () => {
  const stream = new MdxStream({ source: "# Settled\n\nTail" });
  const spy = vi.spyOn(materializer, "materializeStrictDocument");

  try {
    stream.append(" more");
    const kinds = spy.mock.calls.flatMap((call) => call[1].map((block) => block.kind));
    expect(kinds).not.toContain("heading");
    expect(kinds).toContain("paragraph");
  } finally {
    spy.mockRestore();
  }
});

it("parses only the open item when an open list grows", () => {
  const stream = new MdxStream({ source: "- *item*\n".repeat(50) });
  const spy = vi.spyOn(inlineParser, "parseInline");

  try {
    stream.append("- *new*");
    stream.append(" item");
    // Each append parses only the open item, never the 50 settled items.
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(6);
  } finally {
    spy.mockRestore();
  }
});

it("reuses settled block snapshots by identity", () => {
  const stream = new MdxStream({ source: "One\n\nTwo\n\nThree" });
  const before = stream.append("");
  const after = stream.append(" more");

  expect(after.blocks[0]).toBe(before.blocks[0]);
  expect(after.blocks[1]).toBe(before.blocks[1]);
  expect(after.blocks[2]).not.toBe(before.blocks[2]);
});

it.each([
  ["- a\n- b", 6],
  ['<A x="y">z</A>', 3],
  ["- [^a]: foot\n\n  ref[^a]", 8],
] as const)("uses strict node counting for %s", (source, maximumNodes) => {
  const options = { source, limits: { maximumNodes } };
  expect(new MdxStream(options).append("").status).toBe("valid");
  expect(parse(source, { limits: options.limits }).kind).toBe("ok");
});

it("bounds the whole pending container", () => {
  const stream = new MdxStream({
    source: "- one\n- two\n- **x",
    maximumPendingBlockLength: 4,
  });

  expect(stream.append("").status).toBe("limitExceeded");
});
