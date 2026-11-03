import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { asNative, asMock } from "../../tests/audio.ts";
import {
  AudioRecorder,
  AudioDisposedError,
  AudioUnsupportedError,
  createAudioRecordingFileName,
  createAudioRecordingUrl,
  getAudioRecordingFileExtension,
  getSupportedAudioRecorderMimeType,
  revokeAudioRecordingUrl,
} from "../mod.ts";

class MockMediaRecorder {
  static isTypeSupported = vi.fn<(mimeType: string) => boolean>(
    (mimeType) => mimeType === "audio/webm",
  );

  readonly listeners = new Map<string, Set<EventListener>>();
  readonly mimeType: string;
  readonly stream: MediaStream;
  state: MediaRecorder["state"] = "inactive";

  constructor(stream: MediaStream, options: MediaRecorderOptions = {}) {
    this.stream = stream;
    this.mimeType = options.mimeType ?? "audio/webm";
  }

  addEventListener = vi.fn<
    (type: string, listener: EventListener, options?: AddEventListenerOptions | boolean) => void
  >((type, listener) => {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  });

  removeEventListener = vi.fn<(type: string, listener: EventListener) => void>((type, listener) => {
    this.listeners.get(type)?.delete(listener);
  });

  start = vi.fn<(timeslice?: number) => void>(() => {
    this.state = "recording";
    this.dispatch("start", new Event("start"));
  });

  pause = vi.fn<() => void>(() => {
    this.state = "paused";
    this.dispatch("pause", new Event("pause"));
  });

  resume = vi.fn<() => void>(() => {
    this.state = "recording";
    this.dispatch("resume", new Event("resume"));
  });

  requestData = vi.fn<() => void>(() => {
    this.dispatchData("requested");
  });

  stop = vi.fn<() => void>(() => {
    this.dispatchData("stopped");
    this.state = "inactive";
    this.dispatch("stop", new Event("stop"));
  });

  dispatch(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  dispatchData(value: string): void {
    const blob = new Blob([value], { type: this.mimeType });
    const event = asNative<BlobEvent>({ data: blob, type: "dataavailable" });

    for (const listener of this.listeners.get("dataavailable") ?? []) {
      listener(event);
    }
  }
}

class MockRecorderAudioContext {
  readonly currentTime = 0;
  readonly destination = asNative<AudioDestinationNode>({});
  readonly sampleRate = 44_100;
  readonly state: BaseAudioContext["state"] = "running";

  createMediaStreamDestination = vi.fn<() => MediaStreamAudioDestinationNode>(() =>
    asNative<MediaStreamAudioDestinationNode>({
      connect: vi.fn<(destinationNode: AudioNode | AudioParam) => AudioNode>(() =>
        asNative<AudioNode>({}),
      ),
      disconnect: vi.fn<() => void>(),
      stream: {},
    }),
  );
}

beforeEach(() => {
  vi.stubGlobal("MediaRecorder", MockMediaRecorder);
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn<(blob: Blob) => string>((blob) => `blob:${blob.type || "audio"}`),
    revokeObjectURL: vi.fn<(url: string) => void>(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AudioRecorder", () => {
  it("records audio routed into a MediaStream destination", async () => {
    const context = new MockRecorderAudioContext();

    const audioRecorder = new AudioRecorder(asNative<BaseAudioContext>(context), {
      mimeType: "audio/webm",
    });

    expect(context.createMediaStreamDestination).toHaveBeenCalledTimes(1);
    expect(audioRecorder.destination.stream).toBe(audioRecorder.stream);
    expect(audioRecorder.mimeType).toBe("audio/webm");
    expect(audioRecorder.recorder.state).toBe("inactive");
    expect(audioRecorder.state).toBe("stopped");

    await audioRecorder.start(25);
    expect(audioRecorder.recorder.state).toBe("recording");
    expect(audioRecorder.state).toBe("started");
    expect(asMock<MockMediaRecorder>(audioRecorder.recorder).start).toHaveBeenCalledWith(25);

    audioRecorder.requestData();
    audioRecorder.pause();
    expect(audioRecorder.recorder.state).toBe("paused");
    expect(audioRecorder.state).toBe("paused");

    await audioRecorder.start();
    expect(audioRecorder.recorder.state).toBe("recording");
    expect(audioRecorder.state).toBe("started");
    expect(asMock<MockMediaRecorder>(audioRecorder.recorder).resume).toHaveBeenCalledTimes(1);

    const blob = await audioRecorder.stop();

    expect(blob.type).toBe("audio/webm");
    expect(blob.size).toBeGreaterThan(0);
    expect(audioRecorder.recorder.state).toBe("inactive");
    expect(audioRecorder.state).toBe("stopped");
  });

  it("selects the first supported recorder MIME type", () => {
    expect(getSupportedAudioRecorderMimeType(["audio/mp4", "audio/webm"])).toBe("audio/webm");
    expect(getSupportedAudioRecorderMimeType()).toBe("audio/webm");
    expect(getSupportedAudioRecorderMimeType(["audio/mp4"])).toBeUndefined();
  });

  it("creates and revokes recording object URLs", () => {
    const urlApi = asMock<{
      readonly createObjectURL: { readonly mock: { readonly calls: Array<[Blob]> } };
      readonly revokeObjectURL: { readonly mock: { readonly calls: Array<[string]> } };
    }>(globalThis.URL);

    const blob = new Blob(["recording"], { type: "audio/webm" });

    const url = createAudioRecordingUrl(blob);
    revokeAudioRecordingUrl(url);

    expect(url).toBe("blob:audio/webm");
    expect(urlApi.createObjectURL.mock.calls).toEqual([[blob]]);
    expect(urlApi.revokeObjectURL.mock.calls).toEqual([[url]]);
  });

  it("maps recorder MIME types to file extensions and names", () => {
    expect(getAudioRecordingFileExtension("audio/webm;codecs=opus")).toBe("webm");
    expect(getAudioRecordingFileExtension("audio/ogg;codecs=opus")).toBe("ogg");
    expect(getAudioRecordingFileExtension("audio/mp4")).toBe("m4a");
    expect(getAudioRecordingFileExtension("audio/mpeg")).toBe("mp3");
    expect(getAudioRecordingFileExtension("audio/wav")).toBe("wav");
    expect(getAudioRecordingFileExtension("audio/unknown", "bin")).toBe("bin");
    expect(getAudioRecordingFileExtension(undefined, ".bad ext")).toBe("badext");

    expect(
      createAudioRecordingFileName("audio/webm", {
        name: " take 01 / main ",
      }),
    ).toBe("take-01-main.webm");
    expect(createAudioRecordingFileName(undefined, { fallbackExtension: "ogg", name: "..." })).toBe(
      "recording.ogg",
    );
  });

  it("throws when recording object URLs are unavailable", () => {
    vi.stubGlobal("URL", {});

    expect(() => createAudioRecordingUrl(new Blob())).toThrow(AudioUnsupportedError);
    expect(() => revokeAudioRecordingUrl("blob:recording")).not.toThrow();
  });

  it("returns buffered data when stopped while inactive", async () => {
    const audioRecorder = new AudioRecorder(
      asNative<BaseAudioContext>(new MockRecorderAudioContext()),
    );

    await expect(audioRecorder.stop()).resolves.toMatchObject({
      size: 0,
      type: "audio/webm",
    });
  });

  it("resolves when async recorder start and resume events fire", async () => {
    const audioRecorder = new AudioRecorder(
      asNative<BaseAudioContext>(new MockRecorderAudioContext()),
    );

    await expect(audioRecorder.start(50)).resolves.toBeUndefined();
    expect(audioRecorder.recorder.state).toBe("recording");
    expect(asMock<MockMediaRecorder>(audioRecorder.recorder).start).toHaveBeenCalledWith(50);

    audioRecorder.pause();
    await expect(audioRecorder.start()).resolves.toBeUndefined();
    expect(asMock<MockMediaRecorder>(audioRecorder.recorder).resume).toHaveBeenCalledTimes(1);

    await expect(audioRecorder.start()).resolves.toBeUndefined();
  });

  it("disposes the recorder and rejects later control calls", async () => {
    const audioRecorder = new AudioRecorder(
      asNative<BaseAudioContext>(new MockRecorderAudioContext()),
    );

    await audioRecorder.start();
    expect(audioRecorder.disposed).toBe(false);
    audioRecorder.dispose();
    audioRecorder.dispose();

    expect(audioRecorder.disposed).toBe(true);
    expect(audioRecorder.recorder.state).toBe("inactive");
    expect(audioRecorder.state).toBe("stopped");
    expect(() => audioRecorder.start()).toThrow(AudioDisposedError);
  });

  it("throws when recording support is unavailable", () => {
    vi.stubGlobal("MediaRecorder", undefined);

    expect(
      () => new AudioRecorder(asNative<BaseAudioContext>(new MockRecorderAudioContext())),
    ).toThrow(AudioUnsupportedError);
  });

  it("throws when stream destinations are unavailable", () => {
    const context = asNative<BaseAudioContext>({
      currentTime: 0,
      destination: {},
      state: "running",
    });

    expect(() => new AudioRecorder(context)).toThrow(AudioUnsupportedError);
  });
});
