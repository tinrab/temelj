import {
  AudioRecorder,
  analyser,
  applyAutomation,
  bufferSource,
  createAudioContext,
  decodeAudioData,
  destination,
  gain,
  graphSnapshotToString,
  inspectGraph,
  isAudioContextSupported,
  mediaStreamSource,
  oscillator,
  patch,
  renderOffline,
  requestAudioInputStream,
  stopMediaStream,
  type AudioPatch,
  type Blueprint,
  type OnlineAudioContextFacade,
  type PlayContext,
  type PlayHandle,
  type SourceBlueprint,
} from "@temelj/audio";

import { readProgramResult, type Program } from "./compile";

export type InputKind = "demo" | "microphone" | "file";

export type RunResult = {
  readonly graph: string;
  readonly nodeCount: number;
};

const SOURCE_TYPES: ReadonlySet<string> = new Set(["bufferSource", "noise", "oscillator"]);

/**
 * Owns the audio context, the selected input, and the running patch. Every run builds a fresh
 * graph: input → program → master gain → analyser → destination.
 */
export class PlaygroundEngine {
  #context: OnlineAudioContextFacade | undefined;
  #input: InputKind = "demo";
  #stream: MediaStream | undefined;
  #fileBuffer: AudioBuffer | undefined;
  #demoBuffer: AudioBuffer | undefined;
  #patch: AudioPatch | undefined;
  #handle: PlayHandle | undefined;
  #analyser: AnalyserNode | undefined;
  #master: GainNode | undefined;
  #volume = 0.8;
  #recorder: AudioRecorder | undefined;
  #fileLabel = "";

  get input(): InputKind {
    return this.#input;
  }

  get analyser(): AnalyserNode | undefined {
    return this.#analyser;
  }

  get isRunning(): boolean {
    return this.#handle !== undefined;
  }

  get isRecording(): boolean {
    return this.#recorder !== undefined;
  }

  get fileName(): string | undefined {
    return this.#fileBuffer === undefined ? undefined : this.#fileLabel;
  }

  static isSupported(): boolean {
    return isAudioContextSupported();
  }

  async useDemo(): Promise<void> {
    this.#releaseMicrophone();
    this.#input = "demo";
  }

  async useMicrophone(): Promise<void> {
    if (this.#stream === undefined) {
      this.#stream = await requestAudioInputStream({
        constraints: { autoGainControl: false, echoCancellation: true, noiseSuppression: false },
      });
    }

    this.#input = "microphone";
  }

  async useFile(file: File): Promise<void> {
    const context = this.#ensureContext();
    this.#fileBuffer = await decodeAudioData(context, await file.arrayBuffer());
    this.#fileLabel = file.name;
    this.#releaseMicrophone();
    this.#input = "file";
  }

  /**
   * Builds the program's graph around the selected input and starts playing it.
   */
  async run(program: Program): Promise<RunResult> {
    const context = this.#ensureContext();
    await context.resume();
    this.stop();

    const input = await this.#createInput();
    const { output: processed, play } = readProgramResult(program(input));

    const master = gain({ gain: this.#volume });
    const meter = analyser({ fftSize: 2048, smoothingTimeConstant: 0.8 });
    const speakers = destination();
    processed.connect(master).connect(meter).connect(speakers);

    const sources = collectSources(speakers);
    this.#patch = patch(context, speakers);
    this.#handle = this.#patch.play((playContext) => {
      for (const source of sources) {
        playContext.start(source);
      }

      this.#master = playContext.get(master);
      this.#analyser = playContext.get(meter);
      play?.(playContext);
    });

    const snapshot = inspectGraph([speakers]);

    return { graph: graphSnapshotToString(snapshot), nodeCount: snapshot.nodes.length };
  }

  stop(): void {
    if (this.#recorder !== undefined) {
      void this.stopRecording();
    }

    this.#handle?.stop();
    this.#handle?.dispose();
    this.#patch?.dispose();
    this.#handle = undefined;
    this.#patch = undefined;
    this.#analyser = undefined;
    this.#master = undefined;
  }

  setVolume(volume: number): void {
    this.#volume = volume;

    if (this.#master !== undefined && this.#context !== undefined) {
      this.#master.gain.setTargetAtTime(volume, this.#context.immediate(), 0.02);
    }
  }

  async startRecording(): Promise<void> {
    if (this.#master === undefined || this.#context === undefined || this.#recorder) {
      return;
    }

    const recorder = new AudioRecorder(this.#context);
    this.#master.connect(recorder.input);
    this.#recorder = recorder;
    await recorder.start();
  }

  async stopRecording(): Promise<Blob | undefined> {
    const recorder = this.#recorder;

    if (recorder === undefined) {
      return undefined;
    }

    this.#recorder = undefined;
    const blob = await recorder.stop();
    recorder.dispose();

    return blob;
  }

  async dispose(): Promise<void> {
    this.stop();
    this.#releaseMicrophone();
    await this.#context?.close();
    this.#context = undefined;
  }

  #ensureContext(): OnlineAudioContextFacade {
    this.#context ??= createAudioContext();

    return this.#context;
  }

  async #createInput(): Promise<Blueprint> {
    switch (this.#input) {
      case "microphone": {
        if (this.#stream === undefined) {
          await this.useMicrophone();
        }

        return mediaStreamSource(this.#stream!);
      }

      case "file":
        return bufferSource({ buffer: this.#fileBuffer, loop: true });
      case "demo":
        this.#demoBuffer ??= await renderDemoLoop();

        return bufferSource({ buffer: this.#demoBuffer, loop: true });
    }
  }

  #releaseMicrophone(): void {
    if (this.#stream !== undefined) {
      stopMediaStream(this.#stream);
      this.#stream = undefined;
    }
  }
}

/**
 * Every oscillator, noise, and buffer source upstream of `output`, including the sources inside
 * LFOs and effects, so programs never have to start them by hand.
 */
function collectSources(output: Blueprint): SourceBlueprint[] {
  const seen = new Set<Blueprint>();
  const pending: Blueprint[] = [output];
  const sources: SourceBlueprint[] = [];

  while (pending.length > 0) {
    const blueprint = pending.pop()!;

    if (seen.has(blueprint)) {
      continue;
    }

    seen.add(blueprint);

    if (isSource(blueprint)) {
      sources.push(blueprint);
    }

    for (const connection of blueprint.incoming) {
      pending.push(connection.source);
    }
  }

  return sources;
}

function isSource(blueprint: Blueprint): blueprint is SourceBlueprint {
  return SOURCE_TYPES.has(blueprint.type);
}

const DEMO_NOTES = [110, 165, 220, 262, 220, 165, 147, 196] as const;

const DEMO_STEP = 0.25;

/**
 * Renders a two-second plucked arpeggio offline, so the playground works without a microphone.
 */
async function renderDemoLoop(): Promise<AudioBuffer> {
  const output = destination();
  const voice = oscillator({ frequency: DEMO_NOTES[0], type: "sawtooth" });
  const tone = gain({ gain: 0 });
  voice.connect(tone).connect(output);

  return renderOffline(
    { destination: output, duration: DEMO_NOTES.length * DEMO_STEP, numberOfChannels: 1 },
    (context: PlayContext) => {
      const frequency = context.get(voice).frequency;
      const amplitude = context.get(tone).gain;

      DEMO_NOTES.forEach((note, step) => {
        const time = step * DEMO_STEP;
        frequency.setValueAtTime(note, time);
        applyAutomation(amplitude, [
          { time, type: "set", value: 0 },
          { time: time + 0.01, type: "linearRamp", value: 0.5 },
          { time: time + DEMO_STEP - 0.01, type: "exponentialRamp", value: 0.01 },
        ]);
      });

      context.start(voice, { time: 0 });
    },
  );
}
