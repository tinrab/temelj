import { beforeEach, describe, expect, it } from "vitest";

import {
  destination as createDestination,
  diffGraphs,
  diffGraphSnapshots,
  gain,
  graphDiffToString,
  oscillator,
} from "../mod.ts";

let destination = createDestination();

beforeEach(() => {
  destination = createDestination();
});

describe("graph diffing", () => {
  it("diffs graph snapshots by nodes, node options, and edges", () => {
    const diff = diffGraphSnapshots(
      {
        nodes: [
          { id: "gain:1", options: { gain: 0.25 }, type: "gain" },
          { id: "oscillator:1", options: { frequency: 220 }, type: "oscillator" },
        ],
        edges: [{ from: "oscillator:1", to: "gain:1" }],
      },
      {
        nodes: [
          { id: "gain:1", options: { gain: 0.5 }, type: "gain" },
          { id: "filter:1", options: { frequency: 800, type: "lowpass" }, type: "filter" },
        ],
        edges: [
          { from: "filter:1", to: "gain:1" },
          { from: "oscillator:1", output: 0, param: "frequency", to: "filter:1" },
        ],
      },
    );

    expect(diff).toEqual({
      addedEdges: [
        { from: "filter:1", to: "gain:1" },
        { from: "oscillator:1", output: 0, param: "frequency", to: "filter:1" },
      ],
      addedNodes: [
        { id: "filter:1", options: { frequency: 800, type: "lowpass" }, type: "filter" },
      ],
      removedEdges: [{ from: "oscillator:1", to: "gain:1" }],
      removedNodes: [{ id: "oscillator:1", options: { frequency: 220 }, type: "oscillator" }],
      updatedNodes: [
        {
          before: { id: "gain:1", options: { gain: 0.25 }, type: "gain" },
          after: { id: "gain:1", options: { gain: 0.5 }, type: "gain" },
        },
      ],
    });
  });

  it("renders graph diffs as stable text", () => {
    const diff = diffGraphSnapshots(
      {
        nodes: [
          { id: "gain:1", options: { gain: 0.25 }, type: "gain" },
          { id: "oscillator:1", options: { frequency: 220 }, type: "oscillator" },
        ],
        edges: [{ from: "oscillator:1", to: "gain:1" }],
      },
      {
        nodes: [
          { id: "gain:1", options: { gain: 0.5 }, type: "gain" },
          { id: "filter:1", options: { frequency: 800, type: "lowpass" }, type: "filter" },
        ],
        edges: [
          { from: "filter:1", to: "gain:1" },
          { from: "oscillator:1", output: 0, param: "frequency", to: "filter:1" },
        ],
      },
    );

    expect(graphDiffToString(diff)).toBe(
      [
        '+ node filter:1 (type=filter, options={"frequency":800,"type":"lowpass"})',
        '- node oscillator:1 (type=oscillator, options={"frequency":220})',
        '~ node gain:1 {"after":{"id":"gain:1","options":{"gain":0.5},"type":"gain"},"before":{"id":"gain:1","options":{"gain":0.25},"type":"gain"}}',
        "+ edge filter:1 -> gain:1",
        "+ edge oscillator:1:0 -> filter:1.frequency",
        "- edge oscillator:1 -> gain:1",
      ].join("\n"),
    );
  });

  it("renders unchanged graph diffs as a concise message", () => {
    expect(
      graphDiffToString({
        addedEdges: [],
        addedNodes: [],
        removedEdges: [],
        removedNodes: [],
        updatedNodes: [],
      }),
    ).toBe("No graph changes");
  });

  it("diffs graph snapshots by node metadata", () => {
    const diff = diffGraphSnapshots(
      {
        nodes: [
          {
            id: "signal:1",
            metadata: { operation: "constant", sources: [1] },
            options: { offset: 1 },
            type: "signal",
          },
        ],
        edges: [],
      },
      {
        nodes: [
          {
            id: "signal:1",
            metadata: { operation: "constant", sources: [2] },
            options: { offset: 1 },
            type: "signal",
          },
        ],
        edges: [],
      },
    );

    expect(diff.updatedNodes).toEqual([
      {
        before: {
          id: "signal:1",
          metadata: { operation: "constant", sources: [1] },
          options: { offset: 1 },
          type: "signal",
        },
        after: {
          id: "signal:1",
          metadata: { operation: "constant", sources: [2] },
          options: { offset: 1 },
          type: "signal",
        },
      },
    ]);
  });

  it("diffs inspected blueprint graphs", () => {
    const beforeSource = oscillator();
    const beforeAmp = gain();
    beforeSource.connect(beforeAmp);

    const afterSource = oscillator();
    const afterAmp = gain();
    afterSource.connect(afterAmp).connect(destination);

    const diff = diffGraphs([beforeSource], [afterSource]);

    expect(diff.addedEdges).toEqual([
      {
        from: "gain:1",
        to: "destination:1",
      },
    ]);
    expect(diff.addedNodes).toEqual([
      {
        id: "destination:1",
        options: undefined,
        type: "destination",
      },
    ]);
    expect(diff.removedEdges).toEqual([]);
    expect(diff.removedNodes).toEqual([]);
    expect(diff.updatedNodes).toEqual([]);
  });
});
