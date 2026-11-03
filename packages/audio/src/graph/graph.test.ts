/* oxlint-disable anti-slop/no-shape-in-symbol-names -- `WaveShaper` is the Web Audio API name (`WaveShaperNode`, `BaseAudioContext.createWaveShaper()`). */
import { assert, describe, expect, it } from "vitest";

import { createMockAudioBuffer, createMockAudioContext } from "../../tests/audio.ts";
import { AudioGraphError } from "../errors.ts";
import { signal } from "../signal/signal.ts";
import {
  analyser,
  biquadFilter,
  bufferSource,
  chain,
  channelMerger,
  channelSplitter,
  compressor,
  constantSource,
  convolver,
  CrossFadeBlueprint,
  crossFade,
  getConnectableOwner,
  delay,
  destination,
  gain,
  group,
  GroupBlueprint,
  iirFilter,
  master,
  mediaStreamDestination,
  noise,
  oscillator,
  panner,
  player,
  PlayerBlueprint,
  stereoPanner,
  waveShaper,
  workletNode,
} from "./blueprint.ts";
import { diffGraphs, GraphInspectionSession } from "./diff.ts";
import {
  collectGraphPresetResourceReferences,
  createGraphPresetResourceReference,
} from "./preset-resources.ts";
import {
  hydrateGraphPreset,
  hydrateGraphPresetWithResources,
  parseGraphPreset,
  serializeGraphPreset,
} from "./preset.ts";
import { BLUEPRINT_TYPES } from "./registry.ts";
import { graphSnapshotToDot, graphSnapshotToMermaid, graphSnapshotToString } from "./render.ts";
import { inspectGraph } from "./snapshot.ts";

function createGraph() {
  const source = oscillator({ frequency: 110 });
  const filter = biquadFilter({ frequency: 800 });
  const output = destination();
  chain(source, filter, output);
  signal(200).connect(filter.params.frequency);

  return { filter, output, source };
}

describe("inspectGraph", () => {
  it("describes the connected graph with stable ids", () => {
    const { output } = createGraph();

    const snapshot = inspectGraph([output]);

    expect(snapshot.nodes.map((node) => node.id)).toEqual([
      "biquadFilter:1",
      "destination:1",
      "oscillator:1",
      "signal:1",
    ]);
    expect(snapshot.edges).toEqual([
      { from: "biquadFilter:1", to: "destination:1" },
      { from: "oscillator:1", to: "biquadFilter:1" },
      { from: "signal:1", param: "frequency", to: "biquadFilter:1" },
    ]);
    expect(snapshot.nodes.find((node) => node.type === "signal")?.metadata).toEqual({
      operation: "constant",
      sources: [200],
    });
  });

  it("renders snapshots as text, DOT, and Mermaid", () => {
    const snapshot = inspectGraph([createGraph().output]);

    expect(graphSnapshotToString(snapshot)).toContain("oscillator:1 -> biquadFilter:1");
    expect(graphSnapshotToDot(snapshot)).toContain("digraph");
    expect(graphSnapshotToMermaid(snapshot)).toContain("flowchart");
  });
});

describe("graph diffs", () => {
  it("reports added nodes and edges between graphs", () => {
    const source = oscillator();
    const output = destination();
    source.connect(output);
    const before = [output];
    const session = new GraphInspectionSession(before);

    const amp = gain();
    source.disconnect(output);
    chain(source, amp, output);
    const event = session.refresh();

    expect(event.diff.addedNodes.map((node) => node.id)).toEqual(["gain:1"]);
    expect(event.diff.removedEdges).toEqual([{ from: "oscillator:1", to: "destination:1" }]);
    expect(diffGraphs([source], [source]).addedNodes).toEqual([]);
  });
});

describe("graph presets", () => {
  it("round-trips every node option through JSON", () => {
    const curveNode = waveShaper({ curve: Float32Array.from([-1, 0, 1]) });
    const { output, filter } = createGraph();
    filter.connect(curveNode);
    curveNode.connect(output);

    const preset = serializeGraphPreset(inspectGraph([output]));
    const parsed = parseGraphPreset(JSON.parse(JSON.stringify(preset)));
    const hydrated = hydrateGraphPreset(parsed);

    const roots = [...hydrated.byId.values()];
    expect(inspectGraph(roots)).toEqual(inspectGraph([output]));
    expect(hydrated.byId.get("waveShaper:1")?.options).toEqual({
      curve: Float32Array.from([-1, 0, 1]),
    });
  });

  it("round-trips every node type without duplicating composite parts", () => {
    const output = destination();
    const fade = crossFade({ fade: 0.25 });
    const sampler = player({ volume: 0.5 });
    const bus = group([oscillator(), noise({ seed: 1, type: "pink" })], { gain: 0.8 });
    chain(sampler, fade.a);
    chain(constantSource({ offset: 0.5 }), fade.b);
    chain(
      fade,
      biquadFilter({ frequency: 500 }),
      compressor({ ratio: 4 }),
      delay({ delayTime: 0.1 }),
      iirFilter({ feedback: [1, -0.5], feedforward: [0.5] }),
      stereoPanner({ pan: 0.2 }),
      panner({ positionX: 1 }),
      convolver({ disableNormalization: true }),
      waveShaper({ oversample: "2x" }),
      channelSplitter({ numberOfOutputs: 2 }),
      channelMerger({ numberOfInputs: 2 }),
      workletNode("pass", { numberOfInputs: 1 }),
      analyser({ fftSize: 512 }),
      master({ volume: 0.9 }),
      output,
    );
    chain(bus, fade);
    bufferSource({ loop: true }).connect(bus);
    signal(200).connect(fade.params.gain);
    fade.connect(mediaStreamDestination());

    const snapshot = inspectGraph([output]);
    const preset = parseGraphPreset(JSON.parse(JSON.stringify(serializeGraphPreset(snapshot))));
    const hydrated = hydrateGraphPreset(preset);

    const idOf = new Map([...hydrated.byId].map(([id, blueprint]) => [blueprint, id]));

    const edges = [...hydrated.byId].flatMap(([from, blueprint]) =>
      blueprint.outgoing.map(({ destination: target }) =>
        [from, idOf.get(getConnectableOwner(target))].join(" -> "),
      ),
    );

    expect(hydrated.blueprints).toHaveLength(snapshot.nodes.length);
    expect(edges.toSorted()).toEqual(
      snapshot.edges.map((edge) => [edge.from, edge.to].join(" -> ")).toSorted(),
    );
    expect(
      inspectGraph(hydrated.blueprints)
        .nodes.map((node) => node.type)
        .toSorted(),
    ).toEqual(snapshot.nodes.map((node) => node.type).toSorted());

    const hydratedFade = hydrated.byId.get("crossFade:1");
    const hydratedPlayer = hydrated.byId.get("player:1");
    const hydratedGroup = hydrated.byId.get("group:1");
    assert(hydratedFade instanceof CrossFadeBlueprint);
    assert(hydratedPlayer instanceof PlayerBlueprint);
    assert(hydratedGroup instanceof GroupBlueprint);

    expect(
      [hydratedFade.a, hydratedFade.b]
        .map((part) => idOf.get(part) ?? "")
        .toSorted((left, right) => left.localeCompare(right)),
    ).toEqual(["gain:1", "gain:2"]);
    expect(idOf.get(hydratedPlayer.source)).toMatch(/^bufferSource:/);
    expect(hydratedGroup.nodes).toHaveLength(2);
  });

  it("knows every blueprint type it can hydrate", () => {
    expect(BLUEPRINT_TYPES).toContain("oscillator");
    expect(BLUEPRINT_TYPES).toContain("signal");
    expect(BLUEPRINT_TYPES).toHaveLength(27);
  });

  it("rejects malformed presets and dangling edges", () => {
    expect(() => parseGraphPreset({ nodes: [{ id: 1 }], edges: [] })).toThrow(AudioGraphError);
    expect(() => hydrateGraphPreset({ edges: [{ from: "a:1", to: "b:1" }], nodes: [] })).toThrow(
      AudioGraphError,
    );
    expect(() =>
      hydrateGraphPreset({
        edges: [],
        nodes: [
          { id: "gain:1", type: "gain" },
          { id: "gain:1", type: "gain" },
        ],
      }),
    ).toThrow("duplicate");
  });

  it("stores runtime values as resource references and restores them", async () => {
    const buffer = createMockAudioBuffer();
    const context = createMockAudioContext();

    const preset = serializeGraphPreset(
      { edges: [], nodes: [{ id: "bufferSource:1", options: { buffer }, type: "bufferSource" }] },
      { resources: { audioBuffer: new Map([["kick", buffer]]) } },
    );

    expect(preset.nodes[0]?.options).toEqual({
      buffer: createGraphPresetResourceReference("audioBuffer", "kick"),
    });
    expect(collectGraphPresetResourceReferences([preset.nodes[0]?.options]).audioBuffer).toEqual([
      "kick",
    ]);

    const hydrated = await hydrateGraphPresetWithResources(context, preset, {
      sources: { audioBuffer: { kick: buffer } },
    });

    expect(hydrated.byId.get("bufferSource:1")?.options).toEqual({ buffer });
    await expect(hydrateGraphPresetWithResources(context, preset)).rejects.toThrow(AudioGraphError);
  });
});
