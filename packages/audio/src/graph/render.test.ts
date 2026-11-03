import { beforeEach, describe, expect, it } from "vitest";

import {
  destination as createDestination,
  gain,
  graphSnapshotToDot,
  graphSnapshotToMermaid,
  graphSnapshotToString,
  inspectGraph,
  oscillator,
  signal,
} from "../mod.ts";

let destination = createDestination();

beforeEach(() => {
  destination = createDestination();
});

describe("graph rendering", () => {
  it("renders graph edges as text", () => {
    const modulation = oscillator();
    const carrier = oscillator();
    modulation.connect(carrier.params.detune, 0);

    expect(graphSnapshotToString(inspectGraph([modulation]))).toBe(
      "oscillator:1:0 -> oscillator:2.detune",
    );
  });

  it("renders graph snapshot edges as text", () => {
    expect(
      graphSnapshotToString({
        nodes: [
          { id: "oscillator:1", options: undefined, type: "oscillator" },
          { id: "gain:1", options: undefined, type: "gain" },
        ],
        edges: [{ from: "oscillator:1", output: 0, param: "gain", to: "gain:1" }],
      }),
    ).toBe("oscillator:1:0 -> gain:1.gain");
  });

  it("renders isolated nodes as text", () => {
    const source = oscillator();

    expect(graphSnapshotToString(inspectGraph([source]))).toBe("oscillator:1");
  });

  it("renders isolated graph snapshot nodes as text", () => {
    expect(
      graphSnapshotToString({
        nodes: [
          { id: "gain:1", options: undefined, type: "gain" },
          { id: "oscillator:1", options: undefined, type: "oscillator" },
        ],
        edges: [],
      }),
    ).toBe("gain:1\noscillator:1");
  });

  it("renders graph snapshots as Graphviz DOT", () => {
    const source = oscillator({ frequency: 220 });
    const amp = gain({ gain: 0.5 });
    source.connect(amp).connect(destination);

    expect(graphSnapshotToDot(inspectGraph([source]), "Voice")).toBe(
      [
        "digraph Voice {",
        "  rankdir=LR;",
        '  "destination:1" [label="destination:1\\\\ndestination", shape="box"];',
        '  "gain:1" [label="gain:1\\\\ngain", shape="box"];',
        '  "oscillator:1" [label="oscillator:1\\\\noscillator", shape="box"];',
        '  "gain:1" -> "destination:1";',
        '  "oscillator:1" -> "gain:1";',
        "}",
      ].join("\n"),
    );
  });

  it("labels parameter and indexed DOT edges", () => {
    const modulation = oscillator();
    const carrier = oscillator();
    modulation.connect(carrier.params.detune, 0);

    expect(graphSnapshotToDot(inspectGraph([modulation]))).toContain(
      '"oscillator:1" -> "oscillator:2" [label="out 0 / detune"];',
    );
  });

  it("renders node metadata in DOT labels", () => {
    const constant = signal(2);

    expect(graphSnapshotToDot(inspectGraph([constant]))).toContain(
      '"signal:1" [label="signal:1\\\\nsignal\\\\nmetadata: {\\"operation\\":\\"constant\\",\\"sources\\":[2]}", shape="box"];',
    );
  });

  it("escapes DOT graph, node, and edge labels", () => {
    const dot = graphSnapshotToDot(
      {
        nodes: [{ id: 'node"1', options: undefined, type: "line\nbreak" }],
        edges: [{ from: 'node"1', param: 'gain"x', to: 'node"1' }],
      },
      'Graph"Name',
    );

    expect(dot).toBe(
      [
        'digraph Graph\\"Name {',
        "  rankdir=LR;",
        '  "node\\"1" [label="node\\"1\\\\nline\\nbreak", shape="box"];',
        '  "node\\"1" -> "node\\"1" [label="gain\\"x"];',
        "}",
      ].join("\n"),
    );
  });

  it("renders graph snapshots as Mermaid flowcharts", () => {
    const source = oscillator({ frequency: 220 });
    const amp = gain({ gain: 0.5 });
    source.connect(amp).connect(destination);

    expect(graphSnapshotToMermaid(inspectGraph([source]), "TB")).toBe(
      [
        "flowchart TB",
        '  n1["destination:1<br/>destination"]',
        '  n2["gain:1<br/>gain"]',
        '  n3["oscillator:1<br/>oscillator"]',
        "  n2 --> n1",
        "  n3 --> n2",
      ].join("\n"),
    );
  });

  it("labels parameter and indexed Mermaid edges", () => {
    const modulation = oscillator();
    const carrier = oscillator();
    modulation.connect(carrier.params.detune, 0);

    expect(graphSnapshotToMermaid(inspectGraph([modulation]))).toContain(
      'n1 -->|"out 0 / detune"| n2',
    );
  });

  it("renders node metadata in Mermaid labels", () => {
    const constant = signal(2);

    expect(graphSnapshotToMermaid(inspectGraph([constant]))).toContain(
      'n1["signal:1<br/>signal<br/>metadata: {#quot;operation#quot;:#quot;constant#quot;,#quot;sources#quot;:[2]}"]',
    );
  });

  it("escapes Mermaid node and edge labels", () => {
    const mermaid = graphSnapshotToMermaid(
      {
        nodes: [{ id: 'node"1', options: undefined, type: "line\nbreak" }],
        edges: [{ from: 'node"1', param: 'gain"x', to: 'node"1' }],
      },
      "RL",
    );

    expect(mermaid).toBe(
      ["flowchart RL", '  n1["node#quot;1<br/>line<br/>break"]', '  n1 -->|"gain#quot;x"| n1'].join(
        "\n",
      ),
    );
  });
});
