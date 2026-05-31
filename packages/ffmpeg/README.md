<p align="center">
  <h1 align="center" style="text-decoration:none;">@temelj/ffmpeg</h1>
  <br/>
  <p align="center">
    Type-safe fluent builder for ffmpeg.
  </p>
</p>

<p align="center">
  <a href="https://twitter.com/tinrab" rel="nofollow"><img src="https://img.shields.io/badge/created%20by-@tinrab-1d9bf0.svg" alt="Created by Tin Rabzelj"></a>
  <a href="https://jsr.io/@temelj/ffmpeg" rel="nofollow"><img src="https://jsr.io/badges/@temelj/ffmpeg" alt="jsr"></a>
  <a href="https://opensource.org/licenses/MIT" rel="nofollow"><img src="https://img.shields.io/github/license/tinrab/temelj" alt="License"></a>
</p>

<div align="center">
  <a href="https://jsr.io/@temelj/ffmpeg">jsr</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://www.npmjs.com/package/@temelj/ffmpeg">npm</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://github.com/tinrab/temelj/issues/new">Issues</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://twitter.com/tinrab">@tinrab</a>
  <br />
</div>

<br/>
<br/>

## Installation

```sh
# npm
$ npm install @temelj/ffmpeg
# jsr
$ deno add jsr:@temelj/ffmpeg # or jsr add @temelj/ffmpeg
```

## Usage

Build a simple transcode command.

```ts
import { ffmpeg } from "@temelj/ffmpeg";

const command = ffmpeg()
  .global({ overwrite: true, loglevel: "error" })
  .input("input.mp4", { ss: "00:01:00" })
  .output("output.mp4", {
    videoCodec: "libx264",
    audioCodec: "aac",
    videoBitrate: "2M",
    audioBitrate: "128k",
    pixFmt: "yuv420p",
    movflags: "+faststart",
  })
  .toCommandLine();

console.log(command);
// -loglevel error -y -ss 00:01:00 -i input.mp4 -c:v libx264 -c:a aac -b:v 2M -b:a 128k -pix_fmt yuv420p -movflags +faststart output.mp4
```

Build `filter_complex` graphs with typed labels.

```ts
import { ffmpeg, filterGraph } from "@temelj/ffmpeg";

const graph = filterGraph();
const video = graph.videoInput(0).hflip().scale(1280, 720).label("outv");

const args = ffmpeg()
  .input("input.mp4")
  .filterComplex(graph)
  .output("output.mp4")
  .mapLabel(video)
  .build().args;

console.log(args);
// [
//   "-filter_complex",
//   "[0:v]hflip,scale=1280:720[outv]",
//   "-i",
//   "input.mp4",
//   "-map",
//   "[outv]",
//   "output.mp4",
// ]
```

Use structured metadata values and explicit escape hatches.

```ts
import { ffmpeg, unsafe } from "@temelj/ffmpeg";

const args = ffmpeg()
  .input("in.mp4")
  .output("out.mp4", {
    metadataScopes: {
      "s:v:0": {
        metadata: { key: "title", value: "Main Video" },
      },
      "c:0": {
        mapMetadata: unsafe("0:s:0"),
      },
    },
  })
  .build().args;

console.log(args);
// [
//   "-i",
//   "in.mp4",
//   "-metadata:s:v:0",
//   "title=Main Video",
//   "-map_metadata:c:0",
//   "0:s:0",
//   "out.mp4",
// ]
```
