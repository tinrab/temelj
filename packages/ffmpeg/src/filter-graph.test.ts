import { assert, describe, it } from "vitest";

import { ffmpeg } from "./builder.ts";
import { FilterGraphStream } from "./filter-graph.ts";
import { serializeInputMap } from "./mapping.ts";
import { filterGraph, mapInputStream, mapLabel } from "./mod.ts";

describe("mapping helpers", () => {
  it("serializes input stream maps", () => {
    assert.equal(mapInputStream(0, "v", 0), "0:v:0");
    assert.equal(serializeInputMap({ fileIndex: 1, streamType: "a", optional: true }), "1:a?");
    assert.equal(mapLabel(new FilterGraphStream("outv", "video")), "[outv]");
  });
});

describe("filter graph", () => {
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
