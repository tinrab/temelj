import { isString } from "@temelj/value";

import type { GraphDiff } from "./diff.ts";
import type { GraphSnapshot } from "./snapshot.ts";

import { graphDiffToString } from "./diff.ts";
import {
  compareEdges,
  compareNodes,
  diffNodeToString,
  edgeLabel,
  edgeToString,
  stableStringify,
} from "./format.ts";

type ChangeKind = "added" | "removed" | "updated";

type ChangeRow = {
  readonly after: string;
  readonly before: string;
  readonly kind: ChangeKind;
};

const BASE_STYLES = [
  ":root{color-scheme:light dark;font-family:system-ui,sans-serif;background:#f8fafc;color:#111827}",
  "body{margin:0;padding:24px;line-height:1.4}",
  "main{max-width:1120px;margin:0 auto}",
  "h1{font-size:24px;margin:0 0 4px}",
  ".summary{color:#4b5563;margin:0 0 20px}",
  "section{border:1px solid #d1d5db;border-radius:8px;background:#fff;padding:16px;margin:0 0 16px}",
  "code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}",
  "code{white-space:pre-wrap;word-break:break-word;color:#374151}",
  "table{width:100%;border-collapse:collapse;font-size:14px}",
  "th,td{text-align:left;border-bottom:1px solid #e5e7eb;padding:8px;vertical-align:top}",
  "pre{overflow:auto;border:1px solid #e5e7eb;border-radius:6px;padding:12px;background:#f9fafb}",
  "@media (max-width:760px){body{padding:16px}}",
  "@media (prefers-color-scheme:dark){:root{background:#111827;color:#f9fafb}.summary{color:#d1d5db}section{background:#1f2937;border-color:#374151}th,td,pre{border-color:#374151}code{color:#e5e7eb}pre{background:#111827}}",
];

const SNAPSHOT_STYLES = [
  ".layout{display:grid;grid-template-columns:minmax(240px,1fr) minmax(320px,2fr);gap:16px}",
  ".layout section{margin:0}",
  "ul{list-style:none;margin:0;padding:0;display:grid;gap:8px}",
  ".node{border:1px solid #e5e7eb;border-radius:6px;padding:10px;display:grid;gap:4px}",
  ".node span{color:#4b5563;font-size:13px}",
  ".node small{color:#6b7280;font-size:11px;font-weight:600;text-transform:uppercase}",
  "@media (max-width:760px){.layout{grid-template-columns:1fr}}",
  "@media (prefers-color-scheme:dark){.node span{color:#d1d5db}.node small{color:#9ca3af}.node{border-color:#374151}}",
];

const DIFF_STYLES = [
  ".badge{display:inline-block;border-radius:999px;padding:2px 8px;font-size:12px;font-weight:600;text-transform:uppercase}",
  ".added{background:#dcfce7;color:#166534}.removed{background:#fee2e2;color:#991b1b}.updated{background:#fef3c7;color:#92400e}",
  "@media (prefers-color-scheme:dark){.added{background:#14532d;color:#dcfce7}.removed{background:#7f1d1d;color:#fee2e2}.updated{background:#78350f;color:#fef3c7}}",
];

/**
 * Renders a snapshot as a standalone HTML page that lists its nodes and edges and ends with the
 * snapshot JSON. All graph text is escaped.
 */
export function graphSnapshotToHtml(
  snapshot: GraphSnapshot,
  title: string = "Audio Graph Inspector",
): string {
  const nodeItems = [...snapshot.nodes]
    .sort(compareNodes)
    .map((node) => {
      const options = node.options === undefined ? "undefined" : stableStringify(node.options);

      const metadata =
        node.metadata === undefined
          ? []
          : [
              "<small>metadata</small>",
              `<code>${escapeHtml(stableStringify(node.metadata))}</code>`,
            ];

      return [
        `<li class="node" data-node-id="${escapeHtmlAttribute(node.id)}">`,
        `<strong>${escapeHtml(node.id)}</strong>`,
        `<span>${escapeHtml(node.type)}</span>`,
        "<small>options</small>",
        `<code>${escapeHtml(options)}</code>`,
        ...metadata,
        "</li>",
      ].join("");
    })
    .join("");

  const edgeRows = [...snapshot.edges]
    .sort(compareEdges)
    .map((edge) => {
      const target = isString(edge.param) ? `${edge.to}.${edge.param}` : edge.to;

      return tableRow([edge.from, target, edgeLabel(edge) ?? ""].map(escapeHtml));
    })
    .join("");

  return renderPage(
    title,
    [...BASE_STYLES, ...SNAPSHOT_STYLES],
    [
      `<p class="summary">${snapshot.nodes.length} nodes, ${snapshot.edges.length} edges</p>`,
      '<div class="layout">',
      section("Nodes", `<ul>${nodeItems}</ul>`),
      section("Edges", table(["From", "To", "Label"], edgeRows)),
      "</div>",
      section("Snapshot JSON", `<pre>${escapeHtml(stableStringify(snapshot))}</pre>`),
    ],
  );
}

/**
 * Renders a graph diff as a standalone HTML page with node and edge change tables. All graph text
 * is escaped.
 */
export function graphDiffToHtml(diff: GraphDiff, title: string = "Audio Graph Diff"): string {
  const nodeChanges: ChangeRow[] = [
    ...diff.addedNodes.map((node) => added(diffNodeToString(node))),
    ...diff.removedNodes.map((node) => removed(diffNodeToString(node))),
    ...diff.updatedNodes.map((update): ChangeRow => ({
      after: diffNodeToString(update.after),
      before: diffNodeToString(update.before),
      kind: "updated",
    })),
  ];

  const edgeChanges: ChangeRow[] = [
    ...diff.addedEdges.map((edge) => added(edgeToString(edge))),
    ...diff.removedEdges.map((edge) => removed(edgeToString(edge))),
  ];

  return renderPage(
    title,
    [...BASE_STYLES, ...DIFF_STYLES],
    [
      `<p class="summary">${nodeChanges.length} node changes, ${edgeChanges.length} edge changes</p>`,
      section("Node Changes", changeTable(nodeChanges)),
      section("Edge Changes", changeTable(edgeChanges)),
      section("Text Diff", `<pre>${escapeHtml(graphDiffToString(diff))}</pre>`),
    ],
  );
}

function added(after: string): ChangeRow {
  return { after, before: "", kind: "added" };
}

function removed(before: string): ChangeRow {
  return { after: "", before, kind: "removed" };
}

function changeTable(rows: readonly ChangeRow[]): string {
  const body = rows
    .map((row) =>
      tableRow([
        `<span class="badge ${row.kind}">${row.kind}</span>`,
        `<code>${escapeHtml(row.before)}</code>`,
        `<code>${escapeHtml(row.after)}</code>`,
      ]),
    )
    .join("");

  return table(["Kind", "Before", "After"], body);
}

function renderPage(title: string, styles: readonly string[], body: readonly string[]): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>\n${styles.join("\n")}\n</style>`,
    "</head>",
    "<body>",
    "<main>",
    `<h1>${escapeHtml(title)}</h1>`,
    ...body,
    "</main>",
    "</body>",
    "</html>",
  ].join("\n");
}

function section(heading: string, content: string): string {
  return `<section>\n<h2>${heading}</h2>\n${content}\n</section>`;
}

function table(headings: readonly string[], body: string): string {
  const head = headings.map((heading) => `<th>${heading}</th>`).join("");

  return `<table><thead><tr>${head}</tr></thead>\n<tbody>${body}</tbody></table>`;
}

function tableRow(cells: readonly string[]): string {
  return `<tr>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replaceAll("\n", "&#10;");
}
