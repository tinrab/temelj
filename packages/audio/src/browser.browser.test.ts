import { isFunction } from "@temelj/value";
import { beforeEach, describe, expect, it } from "vitest";

import {
  AudioSignal,
  ConvolutionReverb,
  GrainPlayer,
  PingPongDelay,
  PitchShift,
  ReverseDelay,
  Player,
  Synth,
  Volume,
  audioBufferToWavArrayBuffer,
  closeAudioContext,
  createAudioBufferFromChannels,
  createAudioContext,
  createSingleIOWorkletModule,
  destination as createDestination,
  fadeAudioBuffer,
  gain,
  mediaElementSource,
  getAudioContextCapabilities,
  getNativeAudioContext,
  oscillator,
  registerSingleIOWorklet,
  renderOffline,
  group,
  add,
  applyAutomation,
  bufferSource,
  constantSource,
  patch,
  signal,
  resumeAudioContext,
  sliceAudioBuffer,
  suspendAudioContext,
} from "./mod.ts";

function hasNativeAudioContext(): boolean {
  return isFunction(globalThis.AudioContext);
}

function hasNativeOfflineAudioContext(): boolean {
  return isFunction(globalThis.OfflineAudioContext);
}

function getPeak(buffer: AudioBuffer): number {
  let peak = 0;

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);

    for (let index = 0; index < data.length; index++) {
      peak = Math.max(peak, Math.abs(data[index] ?? 0));
    }
  }

  return peak;
}

function readAscii(view: DataView, offset: number, length: number): string {
  return String.fromCharCode(
    ...Array.from({ length }, (_value, index) => view.getUint8(offset + index)),
  );
}

let destination = createDestination();

beforeEach(() => {
  destination = createDestination();
});

describe("browser runtime", () => {
  it("imports package APIs without top-level browser crashes", () => {
    expect(createAudioContext).toBeTypeOf("function");
    expect(renderOffline).toBeTypeOf("function");
    expect(createSingleIOWorkletModule).toBeTypeOf("function");
  });

  it("creates and closes a native AudioContext facade", async () => {
    expect(hasNativeAudioContext()).toBe(true);

    const context = createAudioContext({ autoResume: false });
    const nativeContext = getNativeAudioContext(context);

    expect(nativeContext).toBeInstanceOf(AudioContext);

    const capabilities = getAudioContextCapabilities(context);
    expect(capabilities.audioContext).toBe(true);
    expect(capabilities.decodeAudioData).toBe(true);

    await resumeAudioContext(context);
    expect(context.state === "running" || context.state === "suspended").toBe(true);

    await suspendAudioContext(context);
    expect(context.state === "suspended" || context.state === "closed").toBe(true);

    await closeAudioContext(context);
    expect(context.state).toBe("closed");
  });

  it("plays a media element patch more than once", async () => {
    const context = createAudioContext({ autoResume: false });
    const output = createDestination();
    mediaElementSource(new Audio()).connect(output);
    const audioPatch = patch(context, output);

    try {
      audioPatch.play().dispose();
      // An element can feed only one source node, so the second playback must reuse it.
      expect(() => audioPatch.play().dispose()).not.toThrow();
    } finally {
      await closeAudioContext(context);
    }
  });

  it("renders a real OfflineAudioContext patch with non-silent samples", async () => {
    expect(hasNativeOfflineAudioContext()).toBe(true);

    const source = oscillator({ frequency: 440, type: "sine" });
    const amp = gain({ gain: 0.25 });
    source.connect(amp).connect(destination);

    const rendered = await renderOffline(
      { destination, duration: 0.05, numberOfChannels: 1, sampleRate: 44_100 },
      ({ start, stop, time }) => {
        start(source, { time: time.immediate });
        stop(source, time.plus(0.04));
      },
    );

    expect(rendered.numberOfChannels).toBe(1);
    expect(rendered.length).toBeGreaterThan(0);
    expect(getPeak(rendered)).toBeGreaterThan(0.001);
  });

  it("plays source members of a group without feeding back into them", async () => {
    const first = oscillator({ frequency: 220 });
    const second = oscillator({ frequency: 330 });
    group([first, second], { gain: 0.25 }).connect(destination);

    const rendered = await renderOffline(
      { destination, duration: 0.05, numberOfChannels: 1, sampleRate: 8_000 },
      ({ start }) => {
        start(first, { time: 0 });
        start(second, { time: 0 });
      },
    );

    expect(getPeak(rendered)).toBeGreaterThan(0.001);
  });

  it("renders signal sums at the expected level", async () => {
    add(signal(0.25), signal(0.5)).connect(destination);

    const rendered = await renderOffline(
      { destination, duration: 0.01, numberOfChannels: 1, sampleRate: 8_000 },
      () => undefined,
    );

    expect(rendered.getChannelData(0)[40]).toBeCloseTo(0.75, 5);
  });

  it("runs AudioBuffer helpers against native AudioBuffer objects", () => {
    const buffer = createAudioBufferFromChannels(
      [
        [0, 0.5, 1, 0.5, 0],
        [0, -0.5, -1, -0.5, 0],
      ],
      { sampleRate: 8_000 },
    );

    const sliced = sliceAudioBuffer(buffer, { end: 0.0005, start: 0.000125 });
    const faded = fadeAudioBuffer(sliced, { fadeIn: 0.000125, fadeOut: 0.000125 });
    const wav = audioBufferToWavArrayBuffer(faded);
    const view = new DataView(wav);

    expect(buffer).toBeInstanceOf(AudioBuffer);
    expect(sliced.length).toBe(3);
    expect(faded.numberOfChannels).toBe(2);
    expect(readAscii(view, 0, 4)).toBe("RIFF");
    expect(readAscii(view, 8, 4)).toBe("WAVE");
  });

  it("registers an AudioWorklet module when the browser supports worklets", async () => {
    expect(hasNativeAudioContext()).toBe(true);

    const context = createAudioContext({ autoResume: false });
    const nativeContext = getNativeAudioContext(context);

    try {
      if (!nativeContext.audioWorklet) {
        return;
      }

      const processorName = `temelj-smoke-${crypto.randomUUID()}`;

      const moduleSource = createSingleIOWorkletModule({
        processorName,
        processSource: `
const input = inputs[0];
const output = outputs[0];
for (let channel = 0; channel < output.length; channel++) {
  const inputChannel = input[channel];
  const outputChannel = output[channel];
  if (inputChannel) {
    outputChannel.set(inputChannel);
  }
}
return true;
`,
      });

      await expect(
        registerSingleIOWorklet(nativeContext, { moduleSource, processorName }),
      ).resolves.toBe(processorName);
    } finally {
      await closeAudioContext(context);
    }
  });
});

describe("runtime units in a real OfflineAudioContext", () => {
  const sampleRate = 8_000;

  function createOffline(seconds: number): OfflineAudioContext {
    return new OfflineAudioContext(1, Math.round(seconds * sampleRate), sampleRate);
  }

  it("plays a buffer through Player at the output volume", async () => {
    if (!hasNativeOfflineAudioContext()) {
      return;
    }

    const context = createOffline(0.25);

    const buffer = createAudioBufferFromChannels([new Float32Array(2_000).fill(0.5)], {
      sampleRate,
    });

    const player = new Player(context, buffer, { volume: 0.5 });

    player.connect(context.destination);
    player.start({ time: 0 });
    const rendered = await context.startRendering();

    expect(rendered.getChannelData(0)[100]).toBeCloseTo(0.25, 5);
  });

  it("fades a stopped Player out from its current level", async () => {
    const context = createOffline(1);

    const ones = createAudioBufferFromChannels([new Float32Array(sampleRate).fill(1)], {
      sampleRate,
    });

    const player = new Player(context, ones, { fadeOut: 0.1 });
    player.connect(context.destination);
    player.start({ time: 0 });
    player.stop(0.5);
    const data = (await context.startRendering()).getChannelData(0);

    expect(data[Math.round(0.45 * sampleRate)]).toBeCloseTo(1, 3);
    expect(data[Math.round(0.5 * sampleRate)]).toBeCloseTo(1, 2);
    expect(data[Math.round(0.55 * sampleRate)]).toBeCloseTo(0.5, 2);
    expect(data[Math.round(0.65 * sampleRate)]).toBe(0);
  });

  it("cross-fades grains so a constant buffer stays constant", async () => {
    const context = createOffline(1);

    const ones = createAudioBufferFromChannels([new Float32Array(sampleRate).fill(1)], {
      sampleRate,
    });

    const grains = new GrainPlayer(context, ones, { grainSize: 0.1, overlap: 0.02 });
    grains.connect(context.destination);
    grains.start({ duration: 0.8, time: 0 });
    const data = (await context.startRendering()).getChannelData(0);

    // Grain boundaries fall every 0.1 s; the cross-fade there must not dip.
    for (const time of [0.2, 0.3, 0.45, 0.5]) {
      expect(data[Math.round(time * sampleRate)], `at ${time}s`).toBeCloseTo(1, 1);
    }
  });

  it("applies Volume in decibels and silences it when muted", async () => {
    if (!hasNativeOfflineAudioContext()) {
      return;
    }

    const context = createOffline(0.1);
    const source = new AudioSignal(context, "normalRange", { value: 1 });
    const volume = new Volume(context, { volume: -6 });

    source.connect(volume.input);
    volume.connect(context.destination);
    volume.mute(0.05);
    const rendered = await context.startRendering();
    const data = rendered.getChannelData(0);

    expect(data[100]).toBeCloseTo(0.501_187, 4);
    expect(data[600]).toBe(0);
  });

  it("renders a synth note and releases it to silence", async () => {
    if (!hasNativeOfflineAudioContext()) {
      return;
    }

    const context = createOffline(0.5);
    const synth = new Synth(context, { envelope: { attack: 0.01, release: 0.05 } });

    synth.connect(context.destination);
    synth.triggerAttackRelease("A4", 0.1, { time: 0 });
    const rendered = await context.startRendering();
    const data = rendered.getChannelData(0);
    let early = 0;

    for (let index = 0; index < 800; index++) {
      early = Math.max(early, Math.abs(data[index] ?? 0));
    }

    expect(early).toBeGreaterThan(0.1);
    expect(Math.abs(data[3_900] ?? 1)).toBeLessThan(1e-3);
  });

  it("produces a reverb tail after the input stops", async () => {
    if (!hasNativeOfflineAudioContext()) {
      return;
    }

    const context = createOffline(0.5);
    const impulse = createAudioBufferFromChannels([[1]], { sampleRate });
    const player = new Player(context, impulse);
    const reverb = new ConvolutionReverb(context, { decay: 0.3, preDelay: 0, wet: 1 });

    player.connect(reverb.input);
    reverb.connect(context.destination);
    player.start({ time: 0 });
    const rendered = await context.startRendering();

    expect(getPeak(rendered)).toBeGreaterThan(0);
    expect(Math.abs(rendered.getChannelData(0)[400] ?? 0)).toBeGreaterThan(0);
  });

  it("keeps ping-pong echoes alternating with decaying feedback", async () => {
    if (!hasNativeOfflineAudioContext()) {
      return;
    }

    const context = new OfflineAudioContext(2, sampleRate * 0.25, sampleRate);
    const impulse = createAudioBufferFromChannels([[1]], { sampleRate });
    const player = new Player(context, impulse);
    // 200 frames per echo at 8 kHz. Delays inside a feedback cycle cannot be shorter than one
    // 128-frame render quantum.
    const pingPong = new PingPongDelay(context, { delayTime: 0.025, feedback: 0.5, wet: 1 });

    player.connect(pingPong.input);
    pingPong.connect(context.destination);
    player.start({ time: 0 });
    const rendered = await context.startRendering();

    // Chromium adds a 128-frame render quantum to each pass through a feedback loop, so check the
    // order and level of the echoes rather than their exact frames.
    const echoes: string[] = [];

    for (let frame = 0; frame < rendered.length; frame++) {
      for (const [label, channel] of [
        ["L", 0],
        ["R", 1],
      ] as const) {
        const sample = rendered.getChannelData(channel)[frame] ?? 0;

        if (Math.abs(sample) > 1e-4) {
          echoes.push(`${label} ${sample.toFixed(3)}`);
        }
      }
    }

    expect(echoes.slice(0, 5)).toEqual(["L 1.000", "R 1.000", "L 0.500", "R 0.500", "L 0.250"]);
  });

  it("plays each window of input back reversed one window later", async () => {
    const context = createOffline(0.05);

    if (!("audioWorklet" in context)) {
      return;
    }

    // A 100-frame ramp from 0.01 to 1, with a 100-frame window.
    const ramp = Float32Array.from({ length: 100 }, (_value, index) => (index + 1) / 100);
    const player = new Player(context, createAudioBufferFromChannels([ramp], { sampleRate }));

    const reverse = await ReverseDelay.create(context, {
      delayTime: 100 / sampleRate,
      feedback: 0,
      wet: 1,
    });

    player.connect(reverse.input);
    reverse.connect(context.destination);
    player.start({ time: 0 });
    const rendered = await context.startRendering();

    // The dry ramp, then the same ramp from its end back to its start.
    expect(rendered.getChannelData(0)[99]).toBeCloseTo(1, 5);
    expect(rendered.getChannelData(0)[100]).toBeCloseTo(1, 5);
    expect(rendered.getChannelData(0)[150]).toBeCloseTo(0.5, 5);
    expect(rendered.getChannelData(0)[199]).toBeCloseTo(0.01, 5);
  });

  it.each([
    [12, 800],
    [-12, 200],
  ])("shifts a 400 Hz tone by %i semitones to about %i Hz", async (pitch, expected) => {
    if (!hasNativeOfflineAudioContext()) {
      return;
    }

    const context = createOffline(1);
    const tone = new OscillatorNode(context, { frequency: 400 });
    const shift = new PitchShift(context, { pitch });
    // The shifter always passes the input through; an inverted copy cancels it.
    const invert = new GainNode(context, { gain: -1 });

    tone.connect(shift.input);
    tone.connect(invert).connect(context.destination);
    shift.connect(context.destination);
    tone.start(0);
    shift.start(0);
    const rendered = await context.startRendering();

    // Skip the first window, where the delay lines are still filling.
    const samples = rendered.getChannelData(0).subarray(sampleRate * 0.25);
    let crossings = 0;

    for (let i = 1; i < samples.length; i++) {
      if ((samples[i - 1] ?? 0) < 0 !== (samples[i] ?? 0) < 0) {
        crossings++;
      }
    }

    const frequency = crossings / 2 / (samples.length / sampleRate);
    expect(Math.abs(frequency - expected) / expected).toBeLessThan(0.05);
  });
});

describe("blueprint playback in a real OfflineAudioContext", () => {
  const sampleRate = 8_000;

  // Each sample holds its own time in seconds, so rendered values reveal the playback position.
  function createTimeRamp(seconds: number): AudioBuffer {
    const data = Float32Array.from({ length: seconds * sampleRate }, (_value, index) => {
      return index / sampleRate;
    });

    return createAudioBufferFromChannels([data], { sampleRate });
  }

  function sampleAt(buffer: AudioBuffer, seconds: number): number {
    return buffer.getChannelData(0)[Math.round(seconds * sampleRate)] ?? Number.NaN;
  }

  it("pauses and resumes from the position reached at the scheduled pause time", async () => {
    const context = new OfflineAudioContext(1, 0.4 * sampleRate, sampleRate);
    const source = bufferSource({ buffer: createTimeRamp(1) });
    source.connect(destination);

    const playback = patch(context, destination).play(({ start }) => {
      start(source, { time: 0 });
    });

    playback.pause(0.1);
    playback.resume(0.2);
    const rendered = await context.startRendering();

    expect(sampleAt(rendered, 0.05)).toBeCloseTo(0.05, 3);
    expect(sampleAt(rendered, 0.15)).toBe(0);
    expect(sampleAt(rendered, 0.3)).toBeCloseTo(0.2, 3);
  });

  it("seeks a source to a new position", async () => {
    const context = new OfflineAudioContext(1, 0.2 * sampleRate, sampleRate);
    const source = bufferSource({ buffer: createTimeRamp(1) });
    source.connect(destination);

    const playback = patch(context, destination).play(({ start }) => {
      start(source, { time: 0 });
    });

    playback.seek(0.5);
    const rendered = await context.startRendering();

    expect(sampleAt(rendered, 0)).toBeCloseTo(0.5, 3);
    expect(sampleAt(rendered, 0.1)).toBeCloseTo(0.6, 3);
  });

  it("delays a source that starts after the position a seek lands on", async () => {
    const context = new OfflineAudioContext(1, 0.4 * sampleRate, sampleRate);

    const silent = bufferSource({
      buffer: createAudioBufferFromChannels([new Float32Array(sampleRate)], { sampleRate }),
    });

    const late = bufferSource({ buffer: createTimeRamp(1) });
    silent.connect(destination);
    late.connect(destination);

    const playback = patch(context, destination).play(({ start }) => {
      start(silent, { time: 0 });
      start(late, { time: 0.2 });
    });

    playback.seek(0.05);
    const rendered = await context.startRendering();

    expect(sampleAt(rendered, 0.1)).toBe(0);
    expect(sampleAt(rendered, 0.25)).toBeCloseTo(0.1, 3);
  });

  it("starts a source again after it was stopped", async () => {
    const context = new OfflineAudioContext(1, 0.4 * sampleRate, sampleRate);
    const source = bufferSource({ buffer: createTimeRamp(1) });
    source.connect(destination);

    patch(context, destination).play(({ start, stop }) => {
      start(source, { time: 0 });
      stop(source, 0.1);
      start(source, { time: 0.2 });
    });

    const rendered = await context.startRendering();

    expect(sampleAt(rendered, 0.05)).toBeCloseTo(0.05, 3);
    expect(sampleAt(rendered, 0.15)).toBe(0);
    expect(sampleAt(rendered, 0.25)).toBeCloseTo(0.05, 3);
  });

  it("starts sources at their scheduled time", async () => {
    const ones = createAudioBufferFromChannels([new Float32Array(sampleRate).fill(1)], {
      sampleRate,
    });

    const source = bufferSource({ buffer: ones });
    source.connect(destination);

    const rendered = await renderOffline(
      { destination, duration: 0.2, numberOfChannels: 1, sampleRate },
      ({ start }) => {
        start(source, { time: 0.1 });
      },
    );

    expect(sampleAt(rendered, 0.05)).toBe(0);
    expect(sampleAt(rendered, 0.15)).toBe(1);
  });

  it("renders param automation ramps", async () => {
    const source = constantSource({ offset: 1 });
    const amp = gain({ gain: 0 });
    source.connect(amp).connect(destination);

    const rendered = await renderOffline(
      { destination, duration: 1, numberOfChannels: 1, sampleRate },
      ({ get }) => {
        applyAutomation(get(amp).gain, [
          { time: 0, type: "set", value: 0 },
          { time: 1, type: "linearRamp", value: 1 },
        ]);
      },
    );

    expect(sampleAt(rendered, 0.25)).toBeCloseTo(0.25, 2);
    expect(sampleAt(rendered, 0.75)).toBeCloseTo(0.75, 2);
  });
});
