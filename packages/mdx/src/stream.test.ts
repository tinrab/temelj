import { describe, expect, it, vi } from "vitest";

import {
  applyBlockEvent,
  blockEvent,
  formatHtml,
  lowerHtml,
  MdxStream,
  parse,
  previewDocument,
  streamBlockEvents,
  SourceFile,
  type HtmlNode,
  type MdxBlockEvent,
  type MdxPreview,
  type MdxStreamChange,
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

function html(snapshot: MdxPreview): string {
  return formatHtml(previewDocument(snapshot));
}

function status(snapshot: MdxStreamSnapshot): string {
  if (snapshot.limit !== undefined) {
    return "limitExceeded";
  }

  return snapshot.blocks.some((block) => block.status === "invalid") ? "invalid" : "valid";
}

function blockHtml(nodes: readonly HtmlNode[]): string {
  return formatHtml({ kind: "root", children: nodes });
}

describe("stream cache validity", () => {
  it("recovers from invalid edits without reusing stale source", () => {
    const stream = new MdxStream({ source: "old\n\nend" });
    const invalid = stream.edit({ start: 0, end: 8, text: "new\n\n<A></B>" });
    expect(status(invalid)).toBe("invalid");
    const start = invalid.file.text.indexOf("B");
    const repaired = stream.edit({ start, end: start + 1, text: "A" });
    expect(html(repaired)).toBe(html(preview(repaired.file.text)));
  });

  it("refreshes footnotes when an identical later definition wins", () => {
    const stream = new MdxStream({ source: "A[^x].\n\n[^x]: same\n\n[^x]: same\n\nend" });
    const next = stream.edit({ start: 8, end: 13, text: "plain" });
    expect(next.footnotes).toEqual(preview(next.file.text).footnotes);
  });

  it("refreshes link definitions inside footnotes", () => {
    const source = "A[^x].\n\n[^x]: [link][g]\n\n[g]: /old";
    const stream = new MdxStream({ source });
    const start = source.indexOf("/old");
    const next = stream.edit({ start, end: start + 4, text: "/new" });
    expect(html(next)).toBe(html(preview(next.file.text)));
    expect(html(next)).toContain('href="/new"');
  });

  it("preserves authored JSX attribute values", () => {
    const node = preview('<A x="&copy;" ').blocks[0]?.nodes[0];

    expect(node).toMatchObject({
      kind: "jsx",
      state: "pending",
      attributes: [{ kind: "jsxAttribute", name: "x", value: "&copy;" }],
    });
  });

  it.each([1, 3, 8, 32])("matches fresh snapshots with %i-character chunks and edits", (size) => {
    const source =
      '# Heading\n\n> - one\n> - **two**\n\nRead[^a] and [guide][g].\n\n[^a]: note\n\n[g]: /guide\n\n<Alert title="hello">child</Alert>\n';

    const stream = new MdxStream();

    for (let offset = 0; offset < source.length; offset += size) {
      const snapshot = stream.append(source.slice(offset, offset + size));
      expect(html(snapshot)).toBe(html(preview(snapshot.file.text)));
    }

    for (const edit of [
      { start: 0, end: 0, text: "Intro\n\n" },
      { start: 10, end: 17, text: "Changed" },
      { start: 0, end: 7, text: "" },
    ]) {
      const snapshot = stream.edit(edit);
      expect(html(snapshot)).toBe(html(preview(snapshot.file.text)));
    }

    const final = stream.complete();
    const batch = parse(final.file.text);

    expect(final.document).toEqual(batch.document);
    expect(formatHtml(lowerHtml(final.document))).toBe(formatHtml(lowerHtml(batch.document)));
  });

  it("enforces node limits across settled and open blocks", () => {
    const stream = new MdxStream({ limits: { maximumNodes: 5 } });
    expect(status(stream.append("one\n\n"))).toBe("valid");
    expect(status(stream.append("two\n\n"))).toBe("valid");
    const limited = stream.append("three");
    expect(status(limited)).toBe("limitExceeded");
    expect(limited.limit).toBe("maximumNodes");
    expect(html(limited)).toBe("<p>one</p>\n<p>two</p>");
    const repaired = stream.edit({ start: 0, end: 15, text: "new" });
    expect(status(repaired)).toBe("valid");
    expect(html(repaired)).toBe("<p>new</p>");
  });

  it("keeps prior snapshots unchanged after shifted edits", () => {
    const stream = new MdxStream({ source: "# First\n\nSecond[^a].\n\n[^a]: note" });
    const before = stream.append("");
    const rendered = html(before);
    const blocks = before.blocks.map((block) => ({ ...block.origin }));
    stream.edit({ start: 0, end: 0, text: "Intro\n\n" });
    expect(before.file.text).toBe("# First\n\nSecond[^a].\n\n[^a]: note");
    expect(before.blocks.map((block) => block.origin)).toEqual(blocks);
    expect(html(before)).toBe(rendered);
  });

  it("renders a reference again when its definition settles later", () => {
    const stream = new MdxStream();
    stream.append("Read [guide][g].\n\nMore\n\n");
    const resolved = stream.append("[g]: /guide\n\nEnd");

    expect(blockHtml(resolved.blocks[0].nodes)).toBe('<p>Read <a href="/guide">guide</a>.</p>');
    expect(blockHtml(resolved.blocks[1].nodes)).toBe("<p>More</p>");
  });
});

describe("long open blocks", () => {
  it.each([7, 32, 97])(
    "render a long open paragraph like a fresh stream with %i-character chunks",
    (size) => {
      const source =
        "Some **bold** text, `code`, and a [link](/x) here.  \n".repeat(120) + "end *open";

      const stream = new MdxStream();
      const snapshots: MdxStreamSnapshot[] = [];

      for (let offset = 0; offset < source.length; offset += size) {
        snapshots.push(stream.append(source.slice(offset, offset + size)));
      }

      // Every 17th snapshot, and the last, match a stream that saw the text at once.
      const sampled = snapshots.filter(
        (_, index) => index % 17 === 0 || index === snapshots.length - 1,
      );

      expect(sampled.map(html)).toEqual(
        sampled.map((snapshot) => html(preview(snapshot.file.text))),
      );

      const completion = stream.complete();
      const batch = parse(source);
      expect(completion.document).toEqual(batch.document);
    },
  );

  it("hides a bare trailing marker after a long list", () => {
    for (let count = 60; count < 70; count++) {
      const rendered = html(preview("- item\n".repeat(count) + "-"));

      expect(rendered).not.toMatch(/<li>\s*<\/li>/u);
      expect(rendered.match(/<li>/gu)).toHaveLength(count);
    }
  });

  it("renders a long growing list like a fresh stream", () => {
    const source = "- item *one* [^a]\n".repeat(150) + "- last\n\n[^a]: Note\n";
    const stream = new MdxStream();
    const snapshots: MdxStreamSnapshot[] = [];

    for (let offset = 0; offset < source.length; offset += 11) {
      snapshots.push(stream.append(source.slice(offset, offset + 11)));
    }

    const sampled = snapshots.filter((_, index) => index % 11 === 0);
    expect(sampled.map(html)).toEqual(sampled.map((snapshot) => html(preview(snapshot.file.text))));
    expect(html(stream.append(""))).toBe(html(preview(source)));
  });
});

describe("stream source", () => {
  it("hands out immutable views of one buffer that share a growing line index", () => {
    const stream = new MdxStream({ source: "# One\r\n" });
    const first = stream.append("two\nthree").file;
    const second = stream.append("\nfour\r\nfive").file;

    // Appends extend one buffer generation: earlier views stay valid prefixes.
    expect(first.isPrefixOf(second)).toBe(true);
    expect(first.text).toBe("# One\r\ntwo\nthree");
    expect(first.lineCount).toBe(new SourceFile(first.text).lineCount);
    expect(second.location(second.length)).toEqual(
      new SourceFile(second.text).location(second.length),
    );

    // An edit starts a new generation, and the earlier views keep their text.
    const edited = stream.edit({ start: 0, end: 1, text: "##" }).file;
    expect(second.isPrefixOf(edited)).toBe(false);
    expect(second.text).toBe("# One\r\ntwo\nthree\nfour\r\nfive");
    expect(edited.line(3)).toEqual(new SourceFile(edited.text).line(3));
  });
});

describe("incremental work", () => {
  it("does not rematerialize settled headings on append", () => {
    const stream = new MdxStream({ source: "# Settled\n\nTail" });
    const spy = vi.spyOn(materializer, "materializeDocument");

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

  it("reports what changed to subscribers", () => {
    const stream = new MdxStream();
    const changes: MdxStreamChange[] = [];
    stream.subscribe((change) => changes.push(change));
    stream.append("One\n\nTwo");
    stream.append("\n\nThree");

    expect(changes.map((change) => change.start)).toEqual([0, 1]);
    expect(changes[1]?.snapshot.blocks.slice(0, 1)).toEqual(
      changes[0]?.snapshot.blocks.slice(0, 1),
    );
  });
});

describe("block events", () => {
  it("rebuilds the preview on a client from update events", async () => {
    const source =
      "# Title\n\nRead [guide][g] and[^a].\n\n- one\n- two\n\n[g]: /guide\n\n[^a]: Note\n";

    async function* chunks(): AsyncGenerator<string> {
      for (let offset = 0; offset < source.length; offset += 5) {
        yield source.slice(offset, offset + 5);
      }
    }

    let client: MdxPreview = { blocks: [], footnotes: undefined };
    const events: MdxBlockEvent[] = [];

    for await (const event of streamBlockEvents(chunks())) {
      events.push(JSON.parse(JSON.stringify(event)));
    }

    for (const event of events) {
      if (event.kind === "update") {
        client = applyBlockEvent(client, event);
      }
    }

    expect(html(client)).toBe(html(preview(source)));
    expect(events.at(-1)?.kind).toBe("complete");
  });

  it("sends only the changed blocks", () => {
    const stream = new MdxStream();
    let event: ReturnType<typeof blockEvent> | undefined;
    stream.subscribe((change) => (event = blockEvent(change)));
    stream.append("One\n\nTwo\n\nThree");
    stream.append(" more");

    expect(event?.start).toBe(2);
    expect(event?.blocks.map((block) => block.id)).toHaveLength(1);
  });
});

it.each([
  ["- a\n- b", 6],
  ['<A x="y">z</A>', 3],
  ["- [^a]: foot\n\n  ref[^a]", 8],
] as const)("uses strict node counting for %s", (source, maximumNodes) => {
  const options = { source, limits: { maximumNodes } };
  expect(status(new MdxStream(options).append(""))).toBe("valid");
  parse(source, { limits: options.limits });
});

it("bounds the whole pending container", () => {
  const stream = new MdxStream({
    source: "- one\n- two\n- **x",
    limits: { maximumPendingBlockLength: 4 },
  });

  expect(stream.append("").limit).toBe("maximumPendingBlockLength");
});
