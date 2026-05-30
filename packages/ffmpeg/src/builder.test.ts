import { assert, describe, it } from "vitest";

import { ffmpeg } from "./builder.ts";

describe("FFmpegBuilder", () => {
  it("builds a minimal command", () => {
    const result = ffmpeg().input("in.mp4").output("out.mp4").build();

    assert.equal(result.args.length, 3);
    assert.deepEqual(result.args, ["-i", "in.mp4", "out.mp4"]);
  });

  it("builds with global options", () => {
    const result = ffmpeg().global({ overwrite: true }).input("in.mp4").output("out.mp4").build();

    assert.deepEqual(result.args, ["-y", "-i", "in.mp4", "out.mp4"]);
  });

  it("builds with global options — noOverwrite", () => {
    const result = ffmpeg().global({ noOverwrite: true }).input("in.mp4").output("out.mp4").build();

    assert.deepEqual(result.args, ["-n", "-i", "in.mp4", "out.mp4"]);
  });

  it("builds with global loglevel", () => {
    const result = ffmpeg().global({ loglevel: "debug" }).input("in.mp4").output("out.mp4").build();

    assert.deepEqual(result.args, ["-loglevel", "debug", "-i", "in.mp4", "out.mp4"]);
  });

  it("builds with global overrides merged", () => {
    const result = ffmpeg()
      .global({ overwrite: true })
      .global({ loglevel: "warning" })
      .input("in.mp4")
      .output("out.mp4")
      .build();

    assert.deepEqual(result.args, ["-loglevel", "warning", "-y", "-i", "in.mp4", "out.mp4"]);
  });

  it("builds with input options", () => {
    const result = ffmpeg().input("in.mp4", { ss: "00:30", t: "10" }).output("out.mp4").build();

    assert.deepEqual(result.args, ["-t", "10", "-ss", "00:30", "-i", "in.mp4", "out.mp4"]);
  });

  it("builds with numerical input options", () => {
    const result = ffmpeg().input("in.mp4", { ss: 30, t: 10.5 }).output("out.mp4").build();

    assert.deepEqual(result.args, ["-t", "10.5", "-ss", "30", "-i", "in.mp4", "out.mp4"]);
  });

  it("builds with boolean input flags", () => {
    const result = ffmpeg().input("in.mp4", { re: true }).output("out.mp4").build();

    assert.deepEqual(result.args, ["-re", "-i", "in.mp4", "out.mp4"]);
  });

  it("builds with output codec options", () => {
    const result = ffmpeg()
      .input("in.mp4")
      .output("out.mp4", { videoCodec: "libx264", audioCodec: "aac" })
      .build();

    assert.deepEqual(result.args, ["-i", "in.mp4", "-c:v", "libx264", "-c:a", "aac", "out.mp4"]);
  });

  it("builds with output bitrate options", () => {
    const result = ffmpeg()
      .input("in.mp4")
      .output("out.mp4", { videoBitrate: "2M", audioBitrate: "128k" })
      .build();

    assert.deepEqual(result.args, ["-i", "in.mp4", "-b:v", "2M", "-b:a", "128k", "out.mp4"]);
  });

  it("builds with video filter", () => {
    const result = ffmpeg().input("in.mp4").output("out.mp4", { vf: "scale=1280:720" }).build();

    assert.deepEqual(result.args, ["-i", "in.mp4", "-vf", "scale=1280:720", "out.mp4"]);
  });

  it("builds with audio filter", () => {
    const result = ffmpeg().input("in.mp4").output("out.mp4", { af: "volume=2.0" }).build();

    assert.deepEqual(result.args, ["-i", "in.mp4", "-af", "volume=2.0", "out.mp4"]);
  });

  it("builds with stream disable flags", () => {
    const result = ffmpeg()
      .input("in.mp4")
      .output("out.mp4", { vn: true, an: true, sn: true })
      .build();

    assert.deepEqual(result.args, ["-i", "in.mp4", "-vn", "-an", "-sn", "out.mp4"]);
  });

  it("builds with map", () => {
    const result = ffmpeg()
      .input("in.mp4")
      .output("out.mp4", { map: ["0:v:0", "0:a:0"] })
      .build();

    assert.deepEqual(result.args, ["-i", "in.mp4", "-map", "0:v:0", "-map", "0:a:0", "out.mp4"]);
  });

  it("builds with crf", () => {
    const result = ffmpeg()
      .input("in.mp4")
      .output("out.mp4", { videoCodec: "libx264", crf: 23 })
      .build();

    assert.deepEqual(result.args, ["-i", "in.mp4", "-c:v", "libx264", "-crf", "23", "out.mp4"]);
  });

  it("builds with pix_fmt and resolution", () => {
    const result = ffmpeg()
      .input("in.mp4")
      .output("out.mp4", { pixFmt: "yuv420p", s: "1280x720" })
      .build();

    assert.deepEqual(result.args, [
      "-i",
      "in.mp4",
      "-s",
      "1280x720",
      "-pix_fmt",
      "yuv420p",
      "out.mp4",
    ]);
  });

  it("builds with frame rate options", () => {
    const result = ffmpeg().input("in.mp4", { r: 30 }).output("out.mp4", { r: 24 }).build();

    assert.deepEqual(result.args, ["-r", "30", "-i", "in.mp4", "-r", "24", "out.mp4"]);
  });

  it("handles multiple inputs and outputs", () => {
    const result = ffmpeg()
      .input("a.mp4")
      .input("b.mp4")
      .output("out1.mp4")
      .output("out2.mp4")
      .build();

    assert.deepEqual(result.args, ["-i", "a.mp4", "-i", "b.mp4", "out1.mp4", "out2.mp4"]);
  });

  it("builds a complex real-world command", () => {
    const result = ffmpeg()
      .global({ overwrite: true, loglevel: "error" })
      .input("input.mp4", { ss: "00:01:00" })
      .output("output.mp4", {
        videoCodec: "libx264",
        audioCodec: "aac",
        videoBitrate: "2M",
        audioBitrate: "128k",
        vf: "scale=1920:1080",
        crf: 23,
        pixFmt: "yuv420p",
        movflags: "+faststart",
      })
      .build();

    const { args } = result;
    assert.ok(args.includes("-loglevel"));
    assert.ok(args.includes("error"));
    assert.ok(args.includes("-y"));
    assert.ok(args.includes("-i"));
    assert.ok(args.includes("input.mp4"));
    assert.ok(args.includes("-c:v"));
    assert.ok(args.includes("libx264"));
    assert.ok(args.includes("-c:a"));
    assert.ok(args.includes("aac"));
    assert.ok(args.includes("-b:v"));
    assert.ok(args.includes("2M"));
    assert.ok(args.includes("-b:a"));
    assert.ok(args.includes("128k"));
    assert.ok(args.includes("-vf"));
    assert.ok(args.includes("scale=1920:1080"));
    assert.ok(args.includes("-crf"));
    assert.ok(args.includes("23"));
    assert.ok(args.includes("-pix_fmt"));
    assert.ok(args.includes("yuv420p"));
    assert.ok(args.includes("-movflags"));
    assert.ok(args.includes("+faststart"));
    assert.ok(args.includes("output.mp4"));

    // Verify structural integrity
    const iIdx = args.indexOf("-i");
    const outIdx = args.indexOf("output.mp4");
    assert.ok(iIdx < outIdx, "-i should come before output");
    assert.ok(iIdx >= 0);
    assert.ok(outIdx >= 0);

    // Global options come before -i
    const logIdx = args.indexOf("-loglevel");
    assert.ok(logIdx < iIdx, "global opt before -i");
  });

  it("builds a filter_complex command", () => {
    const result = ffmpeg()
      .input("input.mp4")
      .global({
        filterComplex: "[0:v]scale=1280:720[v0];[v0]hflip[v]",
      })
      .output("output.mp4", {
        map: ["[v]", "0:a"],
        videoCodec: "libx264",
      })
      .build();

    assert.deepEqual(result.args, [
      "-filter_complex",
      "[0:v]scale=1280:720[v0];[v0]hflip[v]",
      "-i",
      "input.mp4",
      "-map",
      "[v]",
      "-map",
      "0:a",
      "-c:v",
      "libx264",
      "output.mp4",
    ]);
  });

  it("sets raw ffmpeg options through the explicit escape hatch", () => {
    const result = ffmpeg()
      .input("in.mp4")
      .output("out.mp4", {
        videoCodec: "libx264",
        raw: { "-metadata:s:v": "title=Test" },
      })
      .build();

    assert.deepEqual(result.args, [
      "-i",
      "in.mp4",
      "-c:v",
      "libx264",
      "-metadata:s:v",
      "title=Test",
      "out.mp4",
    ]);
  });

  it("builds stream-scoped output options", () => {
    const result = ffmpeg()
      .input("in.mp4")
      .output("out.mp4", {
        streams: {
          "v:0": { videoCodec: "libx264", crf: 21, preset: "slow" },
          "a:0": { audioBitrate: "192k" },
        },
      })
      .build();

    assert.deepEqual(result.args, [
      "-i",
      "in.mp4",
      "-c:v:0",
      "libx264",
      "-preset:v:0",
      "slow",
      "-crf:v:0",
      "21",
      "-b:a:0",
      "192k",
      "out.mp4",
    ]);
  });

  it("builds metadata-scoped output options", () => {
    const result = ffmpeg()
      .input("in.mp4")
      .output("out.mp4", {
        metadataScopes: {
          "s:v:0": { metadata: "title=Main Video" },
          "c:0": { mapMetadata: "0:s:0" },
        },
      })
      .build();

    assert.deepEqual(result.args, [
      "-i",
      "in.mp4",
      "-metadata:s:v:0",
      "title=Main Video",
      "-map_metadata:c:0",
      "0:s:0",
      "out.mp4",
    ]);
  });

  it("returns same build result on repeated calls", () => {
    const b = ffmpeg().input("in.mp4").output("out.mp4");
    const a1 = b.build();
    const a2 = b.build();
    assert.deepEqual(a1, a2);
  });

  it("handles empty input", () => {
    const result = ffmpeg().build();
    assert.deepEqual(result.args, []);
  });

  it("rejects build when inputs exist but no output is defined", () => {
    assert.throws(() => {
      ffmpeg().input("in.mp4").build();
    }, /No output defined/);
  });

  it("rejects input-scoped fluent methods before an input exists", () => {
    assert.throws(() => {
      ffmpeg().seekInput("00:00:05");
    }, /No input defined/);

    assert.throws(() => {
      ffmpeg().inputOptions({ ss: "00:00:05" });
    }, /No input defined/);
  });

  it("rejects output-scoped fluent methods before an output exists", () => {
    assert.throws(() => {
      ffmpeg().videoCodec("libx264");
    }, /No output defined/);

    assert.throws(() => {
      ffmpeg().mapLabel("outv");
    }, /No output defined/);

    assert.throws(() => {
      ffmpeg().outputOptions({ videoCodec: "libx264" });
    }, /No output defined/);
  });

  it("supports fluent input and output convenience methods", () => {
    const result = ffmpeg()
      .input("in.mp4")
      .seekInput("00:00:05")
      .inputDuration(12)
      .output("out.mp4")
      .videoCodec("libx264")
      .audioCodec("aac")
      .videoBitrate("2M")
      .audioBitrate("192k")
      .crf(20)
      .size("1280x720")
      .pixelFormat("yuv420p")
      .videoFilter("scale=1280:720")
      .build();

    assert.deepEqual(result.args, [
      "-t",
      "12",
      "-ss",
      "00:00:05",
      "-i",
      "in.mp4",
      "-s",
      "1280x720",
      "-vf",
      "scale=1280:720",
      "-pix_fmt",
      "yuv420p",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      "-b:v",
      "2M",
      "-b:a",
      "192k",
      "-crf",
      "20",
      "out.mp4",
    ]);
  });
});
