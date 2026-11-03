import { describe, expect, it } from "vitest";

import type { GraphSnapshot } from "./snapshot.ts";

import { diffGraphSnapshots } from "./diff.ts";
import { graphDiffToHtml, graphSnapshotToHtml } from "./html.ts";

const SNAPSHOT: GraphSnapshot = {
  edges: [{ from: "oscillator:0", param: "gain", to: "gain:1" }],
  nodes: [
    { id: "oscillator:0", options: { type: "sine" }, type: "oscillator" },
    { id: "gain:1", metadata: { note: "<b>loud</b>" }, options: { gain: 0.5 }, type: "gain" },
  ],
};

describe("graph html", () => {
  it("renders a snapshot page with sorted nodes, edges, and the snapshot json", () => {
    const html = graphSnapshotToHtml(SNAPSHOT, "Voice");

    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>Voice</title>");
    expect(html).toContain("2 nodes, 1 edges");
    expect(html.indexOf('data-node-id="gain:1"')).toBeLessThan(
      html.indexOf('data-node-id="oscillator:0"'),
    );
    expect(html).toContain("<td>oscillator:0</td><td>gain:1.gain</td><td>gain</td>");
    expect(html).toContain("<h2>Snapshot JSON</h2>");
  });

  it("escapes user-controlled text", () => {
    const html = graphSnapshotToHtml(SNAPSHOT, "<script>alert('x')</script>");

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>loud</b>");
    expect(html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
    expect(html).toContain("&lt;b&gt;loud&lt;/b&gt;");
  });

  it("renders node and edge changes with their kinds", () => {
    const after: GraphSnapshot = {
      edges: [],
      nodes: [
        { id: "gain:1", options: { gain: 1 }, type: "gain" },
        { id: "delay:2", options: undefined, type: "delay" },
      ],
    };

    const html = graphDiffToHtml(diffGraphSnapshots(SNAPSHOT, after));

    expect(html).toContain("<title>Audio Graph Diff</title>");
    expect(html).toContain("3 node changes, 1 edge changes");
    expect(html).toContain('<td><span class="badge added">added</span></td><td><code></code></td>');
    expect(html).toContain('<span class="badge removed">removed</span>');
    expect(html).toContain('<span class="badge updated">updated</span>');
    expect(html).toContain("<h2>Text Diff</h2>");
  });
});
