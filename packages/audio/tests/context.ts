import { vi, type Mock } from "vitest";

import { asNative, MockAudioContext, MockAudioNode, patchGlobal } from "./audio.ts";

export function waitForAsyncDeviceInventory(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

type RecorderListener = (event: Event) => void;

export class MockMediaRecorder {
  static readonly isTypeSupported: Mock<(mimeType: string) => boolean> = vi.fn<
    (mimeType: string) => boolean
  >((mimeType: string) => mimeType === "audio/webm");

  readonly stream: MediaStream;
  readonly listeners: Map<string, Set<RecorderListener>> = new Map();
  readonly mimeType: string;
  state: RecordingState = "inactive";

  constructor(stream: MediaStream, options: MediaRecorderOptions = {}) {
    this.stream = stream;
    this.mimeType = options.mimeType ?? "audio/webm";
  }

  readonly addEventListener: Mock<(type: string, listener: RecorderListener) => void> = vi.fn<
    (type: string, listener: RecorderListener) => void
  >((type: string, listener: RecorderListener) => {
    const listeners = this.listeners.get(type) ?? new Set<RecorderListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  });

  readonly removeEventListener: Mock<(type: string, listener: RecorderListener) => void> = vi.fn<
    (type: string, listener: RecorderListener) => void
  >((type: string, listener: RecorderListener) => {
    this.listeners.get(type)?.delete(listener);
  });

  readonly start: Mock<(timeslice?: number) => void> = vi.fn<(timeslice?: number) => void>(() => {
    this.state = "recording";
    this.dispatch("start", new Event("start"));
  });

  readonly pause: Mock<() => void> = vi.fn<() => void>(() => {
    this.state = "paused";
    this.dispatch("pause", new Event("pause"));
  });

  readonly resume: Mock<() => void> = vi.fn<() => void>(() => {
    this.state = "recording";
    this.dispatch("resume", new Event("resume"));
  });

  readonly requestData: Mock<() => void> = vi.fn<() => void>(() => {
    this.dispatchData("requested");
  });

  readonly stop: Mock<() => void> = vi.fn<() => void>(() => {
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
    const event = asNative<BlobEvent>({
      data: new Blob([value], { type: this.mimeType }),
      type: "dataavailable",
    });

    this.dispatch("dataavailable", event);
  }
}

/**
 * `AudioContext` double installed as the global constructor in context tests.
 */
export class GlobalMockAudioContext extends MockAudioContext {
  baseLatency = 0.01;
  outputLatency = 0.02;
  sinkId: string | { readonly type: "none" } = "";

  constructor(_options?: AudioContextOptions) {
    super(0, 44_100);
    this.state = "suspended";
  }

  readonly getOutputTimestamp: Mock<() => AudioTimestamp> = vi.fn<() => AudioTimestamp>(() => ({
    contextTime: this.currentTime,
    performanceTime: 123,
  }));

  readonly setSinkId: Mock<(sinkId: string | { readonly type: "none" }) => Promise<void>> = vi.fn<
    (sinkId: string | { readonly type: "none" }) => Promise<void>
  >(async (sinkId: string | { readonly type: "none" }) => {
    this.sinkId = sinkId;
  });

  readonly createMediaElementSource: Mock<
    (mediaElement: HTMLMediaElement) => MediaElementAudioSourceNode
  > = vi.fn<(mediaElement: HTMLMediaElement) => MediaElementAudioSourceNode>(() =>
    asNative<MediaElementAudioSourceNode>(new MockAudioNode()),
  );

  readonly createMediaStreamDestination: Mock<() => MediaStreamAudioDestinationNode> = vi.fn<
    () => MediaStreamAudioDestinationNode
  >(() =>
    asNative<MediaStreamAudioDestinationNode>(Object.assign(new MockAudioNode(), { stream: {} })),
  );

  readonly createMediaStreamSource: Mock<(mediaStream: MediaStream) => MediaStreamAudioSourceNode> =
    vi.fn<(mediaStream: MediaStream) => MediaStreamAudioSourceNode>(() =>
      asNative<MediaStreamAudioSourceNode>(new MockAudioNode()),
    );
}

export class GlobalMockOfflineAudioContext extends GlobalMockAudioContext {
  renderResult: AudioBuffer = asNative<AudioBuffer>({ duration: 0 });

  constructor(_options?: OfflineAudioContextOptions) {
    super();
  }

  readonly startRendering: Mock<() => Promise<AudioBuffer>> = vi.fn<() => Promise<AudioBuffer>>(
    async () => this.renderResult,
  );
}

function createMockTrack(): MediaStreamTrack {
  return asNative<MediaStreamTrack>({ stop: vi.fn<() => void>() });
}

function createMockMediaDevices(): MediaDevices {
  return asNative<MediaDevices>({
    addEventListener: vi.fn<(type: string, listener: EventListener) => void>(),
    enumerateDevices: vi.fn<() => Promise<MediaDeviceInfo[]>>(async () =>
      asNative<MediaDeviceInfo[]>([
        { deviceId: "mic-1", groupId: "group-1", kind: "audioinput", label: "Mic" },
        { deviceId: "speaker-1", groupId: "group-2", kind: "audiooutput", label: "Speaker" },
        { deviceId: "camera-1", groupId: "group-3", kind: "videoinput", label: "Camera" },
      ]),
    ),
    getSupportedConstraints: vi.fn<() => MediaTrackSupportedConstraints>(() => ({
      deviceId: true,
      echoCancellation: true,
      noiseSuppression: true,
      width: true,
    })),
    getUserMedia: vi.fn<() => Promise<MediaStream>>(async () => {
      const tracks = [createMockTrack(), createMockTrack()];

      return asNative<MediaStream>({ getTracks: vi.fn<() => MediaStreamTrack[]>(() => tracks) });
    }),
    removeEventListener: vi.fn<(type: string, listener: EventListener) => void>(),
    selectAudioOutput: vi.fn<
      (options?: { readonly deviceId?: string }) => Promise<MediaDeviceInfo>
    >(async (options) => asNative<MediaDeviceInfo>({ deviceId: options?.deviceId ?? "speaker-1" })),
  });
}

/**
 * Installs context, recorder, URL, and media device globals. Returns a restore function.
 */
export function installContextTestGlobals(): () => void {
  const restores = [
    patchGlobal("AudioContext", GlobalMockAudioContext),
    patchGlobal("OfflineAudioContext", GlobalMockOfflineAudioContext),
    patchGlobal("AudioWorkletNode", class MockAudioWorkletNode {}),
    patchGlobal("MediaRecorder", MockMediaRecorder),
    patchGlobal("URL", {
      createObjectURL: vi.fn<(blob: Blob) => string>((blob) => `blob:${blob.type || "audio"}`),
      revokeObjectURL: vi.fn<(url: string) => void>(),
    }),
    patchGlobal("fetch", undefined),
    patchGlobal("navigator", { mediaDevices: createMockMediaDevices() }),
  ];

  return () => {
    for (const restore of restores.reverse()) {
      restore();
    }
  };
}
