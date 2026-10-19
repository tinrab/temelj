import { assert, describe, expect, expectTypeOf, it } from "vitest";

import { ffmpeg } from "./builder.ts";
import { FilterGraphStream } from "./filter-graph.ts";
import { serializeInputMap } from "./mapping.ts";
import { disableMap, filterGraph, mapInputStream, mapLabel, unsafeMapLabel } from "./mod.ts";

describe("mapping helpers", () => {
  it("disables typed input and raw label maps", () => {
    expect(disableMap({ fileIndex: 0, streamType: "a" })).toBe("-0:a");
    expect(disableMap(unsafeMapLabel("audio"))).toBe("-[audio]");
  });
  it("serializes input stream maps", () => {
    assert.equal(mapInputStream(0, "v", 0), "0:v:0");
    assert.equal(serializeInputMap({ fileIndex: 1, streamType: "a", optional: true }), "1:a?");
    assert.equal(mapLabel(new FilterGraphStream("outv", "video")), "[outv]");
  });
});

describe("filter graph", () => {
  it("preserves the requested split count and media type", () => {
    const graph = filterGraph();
    const outputs = graph.videoInput(0).split("single");
    expect(outputs).toHaveLength(1);
    expect(outputs[0]?.mediaType).toBe("video");
    expectTypeOf(outputs).toEqualTypeOf<readonly FilterGraphStream<string, "video">[]>();
    expect(graph.toString()).toBe("[0:v]split=outputs=1[single]");
    const defaults = graph.audioInput(1).asplit();
    expect(defaults.map((output) => output.mediaType)).toEqual(["audio", "audio"]);
  });

  it("preserves mixed output media types", () => {
    const graph = filterGraph();

    const outputs = graph
      .concat([graph.input(0)], { segments: 1, videoStreams: 1, audioStreams: 1 })
      .labels("video", "audio");

    expect(outputs.map((output) => output.mediaType)).toEqual(["video", "audio"]);
    const single = graph.videoInput(1).fps(30).label("typed");
    expectTypeOf(single).toEqualTypeOf<FilterGraphStream<"typed", "video">>();
  });
  it("serializes a simple video chain", () => {
    const graph = filterGraph();
    graph.videoInput(0).scale(1280, 720).fps(30).label("scaled");

    assert.equal(graph.toString(), "[0:v]scale=1280:720,fps=30[scaled]");
  });

  it("serializes a multi-stage overlay graph", () => {
    const graph = filterGraph();
    const base = graph.videoInput(0).scale(1280, 720).label("base");
    const logo = graph.videoInput(1).scale(160, 90).label("logo");
    graph.overlay(base, logo, { x: 10, y: "H-h-10" }).label("outv");

    assert.equal(
      graph.toString(),
      "[0:v]scale=1280:720[base];[1:v]scale=160:90[logo];[base][logo]overlay=x=10:y=H-h-10[outv]",
    );
  });

  it("rejects duplicate output labels", () => {
    const graph = filterGraph();
    graph.videoInput(0).scale(1280, 720).label("dup");

    assert.throws(() => {
      graph.videoInput(1).scale(640, 360).label("dup");
    }, /Duplicate filter graph output label "dup"/);
  });
});

describe("builder integration", () => {
  it("maps input streams fluently", () => {
    const result = ffmpeg()
      .input("in.mp4")
      .output("out.mp4")
      .mapInputStream(0, "v", 0)
      .mapInputStream(0, "a", 0)
      .build();

    assert.deepEqual(result.args, ["-i", "in.mp4", "-map", "0:v:0", "-map", "0:a:0", "out.mp4"]);
  });

  it("accepts a filter graph and mapped label", () => {
    const graph = filterGraph();
    const output = graph.videoInput(0).hflip().scale(1280, 720).label("outv");

    const result = ffmpeg()
      .input("in.mp4")
      .filterComplex(graph)
      .output("out.mp4")
      .mapLabel(output)
      .build();

    assert.deepEqual(result.args, [
      "-filter_complex",
      "[0:v]hflip,scale=1280:720[outv]",
      "-i",
      "in.mp4",
      "-map",
      "[outv]",
      "out.mp4",
    ]);
  });

  it("rejects mapped labels that are not defined in the current filter graph", () => {
    const graph = filterGraph();
    graph.videoInput(0).hflip().label("outv");

    assert.throws(() => {
      ffmpeg()
        .input("in.mp4")
        .filterComplex(graph)
        .output("out.mp4")
        .unsafeMapLabel("missing")
        .build();
    }, /Mapped filter label "missing" is not defined/);
  });

  it("renders a shell-safe command line", () => {
    const command = ffmpeg()
      .global({ overwrite: true, loglevel: "error" })
      .input("input file.mp4")
      .output("out file.mp4")
      .toCommandLine();

    assert.equal(command, "-loglevel error -y -i 'input file.mp4' 'out file.mp4'");
  });
});
