<p align="center">
  <h1 align="center" style="text-decoration:none;">@temelj/audio</h1>
  <br/>
  <p align="center">
    Utilities for working with Web Audio API. Typed Web Audio graphs, instruments, effects, and scheduling.
  </p>
</p>

<p align="center">
  <a href="https://twitter.com/tinrab" rel="nofollow"><img src="https://img.shields.io/badge/created%20by-@tinrab-1d9bf0.svg" alt="Created by Tin Rabzelj"></a>
  <a href="https://jsr.io/@temelj/audio" rel="nofollow"><img src="https://jsr.io/badges/@temelj/audio" alt="jsr"></a>
  <a href="https://opensource.org/licenses/MIT" rel="nofollow"><img src="https://img.shields.io/github/license/tinrab/temelj" alt="License"></a>
</p>

<div align="center">
  <a href="https://jsr.io/@temelj/audio">jsr</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://www.npmjs.com/package/@temelj/audio">npm</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://github.com/tinrab/temelj/issues/new">Issues</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://twitter.com/tinrab">@tinrab</a>
  <br />
</div>

<br/>
<br/>

`@temelj/audio` offers typed building blocks for the Web Audio API.

- Graphs built from blueprints named after the native nodes.
- Synths and effects that connect like ordinary nodes.
- Musical time, so you can write `"4n"` or `"+0.5"` instead of seconds, with a transport to keep callbacks on the beat.
- Browser fixes, like resuming the context after the first click and falling back where Firefox lacks `cancelAndHoldAtTime`.
- AudioWorklet helpers: write the body of `process()` and get a node with typed messaging.
- Graph snapshots you can compare or save as JSON presets.

There are no framework bindings and no global state.
Every function takes the audio context you pass in, so it fits into any app.

## Installation

```sh
# npm
$ npm install @temelj/audio
# pnpm
$ pnpm add @temelj/audio
```

## Overview

There are two kinds of objects:

- **Blueprints** describe audio nodes without creating them.
  You connect blueprints into a graph and pass its destination to `patch()`.
  Each call to `play()` builds fresh native nodes from the graph, so you can play the same graph many times or save it as a preset and load it later.
- **Runtime units** are classes such as `Synth`, `Sampler`, and `PitchShift`.
  They connect like ordinary nodes and release everything in `dispose()`.

Every API takes its audio context as an argument.
The package never creates a context on its own and keeps no global state.

## Quick start

```ts
import { chain, createAudioContext, destination, gain, oscillator, patch } from "@temelj/audio";

const synth = oscillator({ frequency: 220, type: "sawtooth" });
const output = destination();

chain(synth, gain({ gain: 0.2 }), output);

const context = createAudioContext();
const graph = patch(context, output);
const handle = graph.play(({ start }) => {
  start(synth);
});

handle.stop();
graph.dispose();
```

`createAudioContext()` returns a wrapper around `AudioContext`.
It resumes the context on the first user gesture, which browsers require before audio can play.
Without Web Audio it throws `AudioUnsupportedError`, so server-rendered code should check `isAudioContextSupported()` first.

## Blueprint graphs

Each native node has a blueprint factory with the same name: `oscillator()`, `gain()`, `biquadFilter()`, `delay()`, `workletNode()`, and so on.
Composite blueprints such as `crossFade()` and `group()` contain several nodes.
A connection can end at a node or at one of its params.

```ts
import { crossFade, destination, gain, oscillator, patch } from "@temelj/audio";

const output = destination();
const square = oscillator({ frequency: 110, type: "square" });
const sine = oscillator({ frequency: 110 });
const mix = crossFade({ fade: 0.35 });

// A 5 Hz oscillator scaled to +/-30 cents wobbles the square wave's pitch.
const vibrato = oscillator({ frequency: 5 });
vibrato.connect(gain({ gain: 30 })).connect(square.params.detune);

square.connect(mix.a);
sine.connect(mix.b);
mix.connect(output);

patch(new AudioContext(), output).play(({ start }) => {
  start(vibrato);
  start(square);
  start(sine);
});
```

Inside the play callback, `get()` returns the native node built for a blueprint, and `param()` wraps an `AudioParam` with a unit and ramp helpers.

```ts
import { applyAutomation, destination, gain, oscillator, patch } from "@temelj/audio";

const output = destination();
const source = oscillator();
const amp = gain({ gain: 0 });
source.connect(amp).connect(output);

patch(new AudioContext(), output).play(({ get, param, start, time }) => {
  start(source);

  applyAutomation(get(amp).gain, [
    { time: time.immediate, type: "set", value: 0 },
    { time: time.immediate + 0.5, type: "linearRamp", value: 1 },
  ]);

  param(get(source).frequency, "hertz").rampTo(440, 2, time.immediate);
});
```

## Playback

Web Audio source nodes can only be started once.
The handle returned by `play()` works around this.
`pause()`, `resume()`, and `seek()` replace each source with a new node at the right position.
The handle's `currentTime` tracks the playback position, and its `finished` promise resolves when every source has ended.

If you change the graph while it plays, call `refresh()`.
It adds and removes native nodes to match the blueprints and leaves unchanged connections alone.

```ts
import { bufferSource, destination, gain, patch } from "@temelj/audio";

const output = destination();
const sample = bufferSource({ buffer: audioBuffer, loop: true });
sample.connect(output);

const handle = patch(new AudioContext(), output).play(({ start }) => {
  start(sample);
});

handle.pause();
handle.seek(1.5);
handle.resume();

sample.disconnect(output);
sample.connect(gain({ gain: 0.5 })).connect(output);
handle.refresh();

handle.stop();
await handle.finished;
```

To render a graph to an `AudioBuffer` instead of the speakers, use `renderOffline()`:

```ts
import { destination, oscillator, renderOffline } from "@temelj/audio";

const output = destination();
const tone = oscillator({ frequency: 220 });
tone.connect(output);

const buffer = await renderOffline({ destination: output, duration: 0.5 }, ({ start }) => {
  start(tone, { time: 0 });
});
```

## Effects

An effect whose graph never changes is a blueprint.
Create it by name with `createEffect()` or with its own factory, such as `chorus()` or `feedbackDelay()`.

```ts
import { chain, createEffect, destination, oscillator, patch, startLfo } from "@temelj/audio";

const output = destination();
const source = oscillator({ type: "triangle" });
const drive = createEffect("distortion", { amount: 80 });
const echo = createEffect("feedbackDelay", { feedback: 0.35 });
const chorus = createEffect("chorus", { depth: 0.6, frequency: 1.5 });

chain(source, drive, echo, chorus, output);

patch(new AudioContext(), output).play((context) => {
  startLfo(context, chorus.modulator);
  context.start(source);
});
```

Effects that need more than a fixed graph are runtime units.
For example, `ReverseDelay` runs in an AudioWorklet, and `PitchShift` has to be started like a source.
Mixing and dynamics processors, including `Channel`, `Compressor`, `Limiter`, and `EQ3`, are runtime units as well.

```ts
import { Channel, ConvolutionReverb, Limiter } from "@temelj/audio";

const channel = new Channel(context, { pan: -0.1, volume: -6 });
const reverb = new ConvolutionReverb(context, { decay: 1.5, wet: 0.3 });
const limiter = new Limiter(context, { threshold: -3 });

source.connect(channel.input);
channel.connect(reverb.input);
reverb.connect(limiter.input);
limiter.connect(context.destination);
```

## Instruments

Synths take a note as a name such as `"C4"` or as a number.
A whole number from 0 to 127 is a MIDI note, and any other number is a frequency in hertz.

Besides `Synth`, there are `MonoSynth`, `FMSynth`, `AMSynth`, `DuoSynth`, `MembraneSynth`, `MetalSynth`, `NoiseSynth`, and `PluckSynth`.
`PolySynth` plays chords and steals the oldest voice when it runs out.
`Sampler` plays each note by repitching the closest sample it has loaded.

```ts
import { MembraneSynth, PolySynth, Sampler } from "@temelj/audio";

const poly = new PolySynth(context, { maxPolyphony: 8 });
poly.connect(context.destination);
poly.triggerAttackRelease(["C4", "E4", "G4"], "2n");

const kick = new MembraneSynth(context, { octaves: 8, pitchDecay: 0.05 });
kick.connect(context.destination);
kick.triggerAttackRelease("C2", "8n");

const piano = await Sampler.load(
  context,
  { C3: "C3.mp3", C4: "C4.mp3" },
  { baseUrl: "/samples/piano/" },
);
piano.connect(context.destination);
piano.triggerAttackRelease("E3", "4n");
```

## Players and buffers

`Player.load()` accepts a list of files and decodes the first format the browser can play.
For other kinds of playback:

- `Players` holds named players that share one output, such as a drum kit.
- `SpritePlayer` plays named regions of a single file.
- `GrainPlayer` plays a buffer in short grains, so speed and pitch change independently.
- `MediaElementPlayer` streams through an `<audio>` element instead of decoding the whole file.
- `Playlist` plays player blueprints in order, or shuffled by weight.

```ts
import { Player } from "@temelj/audio";

const drums = await Player.load(context, ["/loops/drums.webm", "/loops/drums.wav"], {
  fadeOut: 0.05,
  loop: true,
});
drums.connect(context.destination);
drums.start();
drums.setPlaybackRate(0.75);
drums.stop("+4");
```

The `AudioBuffer` helpers return new buffers and never modify their input.
They don't take an audio context, so you can prepare samples before creating one.

```ts
import {
  audioBufferToWavBlob,
  fadeAudioBuffer,
  getAudioBufferPeak,
  normalizeAudioBuffer,
  sliceAudioBuffer,
  trimAudioBuffer,
} from "@temelj/audio";

const take = trimAudioBuffer(sliceAudioBuffer(audioBuffer, { end: 2, start: 0.5 }));
const master = normalizeAudioBuffer(fadeAudioBuffer(take, { fadeOut: 0.05 }), { peak: 0.9 });

console.log(getAudioBufferPeak(master));
const wav = audioBufferToWavBlob(master);
```

## Scheduling

Anywhere the API takes a time, you can pass seconds or a musical expression.
`"4n"` is a quarter note, `"8t"` an eighth-note triplet, `"1m"` a measure, `"0:2:0"` bars:beats:sixteenths, `"192i"` ticks, and `"+0.5"` half a second from now.

`Transport` keeps a musical position against the audio clock.
When you change its tempo or seek, callbacks that are already scheduled move to their new times.
`Loop`, `Part`, `Sequence`, and `Pattern` schedule repeating musical events on a transport.

```ts
import { PolySynth, Sequence, Transport } from "@temelj/audio";

const transport = new Transport({ bpm: 120, context });
const synth = new PolySynth(context);
synth.connect(context.destination);

const bass = new Sequence(
  transport,
  (time, note) => synth.triggerAttackRelease(note, "8n", { time }),
  ["C2", "G2", "A2", "F2"],
  { interval: "8n", loop: true },
);

transport.scheduleRepeat((time) => console.log("bar", time), "1m");
transport.setLoop(true);
transport.setLoopPoints(0, "4m");

bass.start();
transport.start();
```

## Graph inspection and presets

`inspectGraph()` turns a blueprint graph into a snapshot, a plain list of nodes and edges.
`diffGraphs()` compares two graphs, and snapshots can be rendered as text, Graphviz DOT, Mermaid, or a standalone HTML page.

A snapshot can also be saved as a preset.
Values that JSON can't hold, such as an `AudioBuffer`, are stored as references to resources you supply when loading the preset back.

```ts
import {
  bufferSource,
  destination,
  graphSnapshotToMermaid,
  hydrateGraphPreset,
  inspectGraph,
  parseGraphPreset,
  serializeGraphPreset,
} from "@temelj/audio";

const output = destination();
bufferSource({ buffer: audioBuffer }).connect(output);

const snapshot = inspectGraph([output]);
console.log(graphSnapshotToMermaid(snapshot));

const resources = { audioBuffer: new Map([["kick", audioBuffer]]) };
const json = JSON.stringify(serializeGraphPreset(snapshot, { resources }));
const restored = hydrateGraphPreset(parseGraphPreset(JSON.parse(json)), { resources });
```

## Browser APIs

- Microphone: `requestAudioInputStream()` opens one, and `mediaStreamSource()` adds it to a graph.
- Output devices: `selectAudioOutput()` and `setAudioContextSinkId()` pick where audio plays.
- Recording: `AudioRecorder` records anything connected to it with `MediaRecorder`.
- Analysis: `analyser()` in a graph, or the `Meter` and `FftAnalyser` units.
- Spatial audio: `SpatialPanner` and the listener helpers.
- AudioWorklets: `workletNode()` in a graph, or `WorkletEffect` with typed messages through
  `WorkletMessenger`.

```ts
import { AudioRecorder, getSupportedAudioRecorderMimeType } from "@temelj/audio";

const recorder = new AudioRecorder(context, { mimeType: getSupportedAudioRecorderMimeType() });
source.connect(recorder.input);

await recorder.start();
const recording = await recorder.stop();
recorder.dispose();
```
