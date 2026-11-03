import { afterEach, describe, expect, it, vi } from "vitest";

import type { PlaybackState } from "../unit.ts";

import { patchGlobal, asNative } from "../../tests/audio.ts";
import { AudioDisposedError, MediaElementPlayer } from "../mod.ts";

class MockSourceElement {
  src = "";
  type = "";
  removed = false;

  remove(): void {
    this.removed = true;
  }
}

class MockAudioElement {
  currentTime = 0;
  loop = false;
  muted = false;
  paused = true;
  playbackRate = 1;
  preload = "auto";
  readyState = 0;
  src = "";
  volume = 1;
  readonly appendedSources: MockSourceElement[] = [];
  readonly listeners = new Map<string, Set<EventListener>>();

  addEventListener = vi.fn<(type: string, listener: EventListener) => void>((type, listener) => {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  });

  removeEventListener = vi.fn<(type: string, listener: EventListener) => void>((type, listener) => {
    this.listeners.get(type)?.delete(listener);
  });

  appendChild = vi.fn<(source: MockSourceElement) => MockSourceElement>((source) => {
    this.appendedSources.push(source);

    return source;
  });

  load = vi.fn<() => void>();

  pause = vi.fn<() => void>(() => {
    this.paused = true;
  });

  play = vi.fn<() => Promise<void>>(async () => {
    this.paused = false;
  });

  querySelectorAll = vi.fn<(selector: string) => MockSourceElement[]>((selector) =>
    selector === "source" ? this.appendedSources : [],
  );

  removeAttribute = vi.fn<(name: string) => void>((name) => {
    if (name === "src") {
      this.src = "";
    }
  });

  dispatch(type: string): void {
    const event = new Event(type);

    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

class MockGainNode {
  readonly gain = { value: 1 };
  readonly connect = vi.fn<(destinationNode: AudioNode | AudioParam) => AudioNode>(() =>
    asNative<AudioNode>({}),
  );
  readonly disconnect = vi.fn<() => void>();
}

class MockMediaElementSourceNode {
  readonly connect = vi.fn<(destinationNode: AudioNode | AudioParam) => AudioNode>(() =>
    asNative<AudioNode>({}),
  );
  readonly disconnect = vi.fn<() => void>();
}

function createMockContext(): BaseAudioContext & {
  readonly createdGains: MockGainNode[];
  readonly createdSources: MockMediaElementSourceNode[];
  readonly decodeAudioData: ReturnType<typeof vi.fn<(data: ArrayBuffer) => Promise<AudioBuffer>>>;
} {
  const createdGains: MockGainNode[] = [];
  const createdSources: MockMediaElementSourceNode[] = [];

  return asNative<
    BaseAudioContext & {
      readonly createdGains: MockGainNode[];
      readonly createdSources: MockMediaElementSourceNode[];
      readonly decodeAudioData: ReturnType<
        typeof vi.fn<(data: ArrayBuffer) => Promise<AudioBuffer>>
      >;
    }
  >({
    createdGains,
    createdSources,
    currentTime: 0,
    decodeAudioData: vi.fn<(data: ArrayBuffer) => Promise<AudioBuffer>>(),
    destination: {},
    sampleRate: 48_000,
    state: "running",
    createGain: vi.fn<() => GainNode>(() => {
      const node = new MockGainNode();
      createdGains.push(node);

      return asNative<GainNode>(node);
    }),
    createMediaElementSource: vi.fn<(element: HTMLMediaElement) => MediaElementAudioSourceNode>(
      () => {
        const node = new MockMediaElementSourceNode();
        createdSources.push(node);

        return asNative<MediaElementAudioSourceNode>(node);
      },
    ),
  });
}

const cleanupGlobals: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanupGlobals.splice(0).reverse()) {
    cleanup();
  }
});

function rememberGlobals(): void {
  cleanupGlobals.push(patchGlobal("GainNode", undefined));
}

describe("media element player", () => {
  it("uses a provided element without fetching or decoding", () => {
    rememberGlobals();
    const element = new MockAudioElement();
    const context = createMockContext();
    const fetch = vi.fn<() => Promise<Response>>();
    cleanupGlobals.push(patchGlobal("fetch", fetch));

    const player = new MediaElementPlayer(context, {
      element: asNative<HTMLAudioElement>(element),
      preload: "metadata",
      source: "/stream.mp3",
      volume: 0.5,
    });

    expect(player.output).toBeDefined();
    expect(player.sourceNode).toBeDefined();
    expect(element.src).toBe("/stream.mp3");
    expect(element.preload).toBe("metadata");
    expect(element.volume).toBe(0.5);
    expect(context.createdSources).toHaveLength(1);
    expect(context.createdSources[0]?.connect).toHaveBeenCalledWith(context.createdGains[0]);
    expect(fetch).not.toHaveBeenCalled();
    expect(context.decodeAudioData).not.toHaveBeenCalled();
  });

  it("applies multiple source candidates as source elements", () => {
    rememberGlobals();
    const element = new MockAudioElement();
    const createdSources: MockSourceElement[] = [];
    cleanupGlobals.push(
      patchGlobal("document", {
        createElement: vi.fn<(tagName: string) => MockSourceElement>((tagName) => {
          expect(tagName).toBe("source");
          const source = new MockSourceElement();
          createdSources.push(source);

          return source;
        }),
      }),
    );

    new MediaElementPlayer(undefined, {
      baseUrl: "/audio",
      element: asNative<HTMLAudioElement>(element),
      formats: ["webm", "wav"],
      source: [
        { format: "audio/webm;codecs=opus", src: "loop.webm" },
        { format: "wav", src: "loop.wav" },
        { format: "mp3", src: "loop.mp3" },
      ],
    });

    expect(element.appendedSources).toHaveLength(2);
    expect(createdSources[0]?.src).toBe("/audio/loop.webm");
    expect(createdSources[0]?.type).toBe("audio/webm;codecs=opus");
    expect(createdSources[1]?.src).toBe("/audio/loop.wav");
    expect(createdSources[1]?.type).toBe("audio/wav");
    expect(element.removeAttribute).toHaveBeenCalledWith("src");
    expect(element.load).toHaveBeenCalled();
  });

  it("bridges element events to typed callbacks", () => {
    rememberGlobals();
    const element = new MockAudioElement();

    const player = new MediaElementPlayer(undefined, {
      element: asNative<HTMLAudioElement>(element),
    });

    const events: string[] = [];

    const onPlay = ({ player: eventPlayer }: { readonly player: MediaElementPlayer }): void => {
      events.push(`play:${eventPlayer.state}`);
    };

    player.events.on("play", onPlay);
    player.events.on("load", () => {
      events.push("load");
    });
    player.events.once("end", () => {
      events.push("end");
    });

    element.dispatch("loadedmetadata");
    element.dispatch("play");
    player.events.off("play", onPlay);
    element.dispatch("play");
    element.dispatch("ended");
    element.dispatch("ended");

    expect(player.loaded).toBe(true);
    expect(player.state).toBe<PlaybackState>("stopped");
    expect(events).toEqual(["load", "play:started", "end"]);
  });

  it("supports element controls without a Web Audio context", async () => {
    rememberGlobals();
    const element = new MockAudioElement();

    const player = new MediaElementPlayer(undefined, {
      element: asNative<HTMLAudioElement>(element),
      loop: true,
      mute: true,
      playbackRate: 1.25,
      volume: 0.4,
    });

    const events: string[] = [];
    player.events.on("seek", () => {
      events.push("seek");
    });
    player.events.on("mute", () => {
      events.push("mute");
    });
    player.events.on("volume", () => {
      events.push("volume");
    });
    player.events.on("rate", () => {
      events.push("rate");
    });
    player.events.on("stop", () => {
      events.push("stop");
    });

    await player.play();
    player.seek(12);
    player.setMute(false);
    player.setVolume(0.75);
    player.setPlaybackRate(0.5);
    player.setLoop(false);
    player.stop();
    // Browsers deliver the element's pause event after stop() returns.
    element.dispatch("pause");

    expect(player.output).toBeUndefined();
    expect(player.state).toBe("stopped");
    expect(player.progress).toBe(0);
    expect(element.currentTime).toBe(0);
    expect(element.muted).toBe(false);
    expect(element.volume).toBe(0.75);
    expect(element.playbackRate).toBe(0.5);
    expect(element.loop).toBe(false);
    expect(events).toEqual(["seek", "mute", "volume", "rate", "stop"]);
  });

  it("does not mark playback started when element play rejects", async () => {
    rememberGlobals();
    const element = new MockAudioElement();
    const error = new Error("autoplay blocked");
    element.play.mockRejectedValueOnce(error);

    const player = new MediaElementPlayer(undefined, {
      element: asNative<HTMLAudioElement>(element),
    });

    const onPlay = vi.fn<() => void>();
    player.events.on("play", onPlay);

    await expect(player.play()).rejects.toThrow("autoplay blocked");

    expect(player.state).toBe("stopped");
    expect(onPlay).not.toHaveBeenCalled();
  });

  it("disposes element listeners and Web Audio nodes", async () => {
    rememberGlobals();
    const element = new MockAudioElement();
    const context = createMockContext();

    const player = new MediaElementPlayer(context, {
      element: asNative<HTMLAudioElement>(element),
    });

    player.connect(asNative<AudioNode>({}));
    player.dispose();

    expect(element.pause).toHaveBeenCalled();
    expect(element.removeEventListener).toHaveBeenCalledTimes(5);
    expect(context.createdSources[0]?.disconnect).toHaveBeenCalled();
    expect(context.createdGains[0]?.disconnect).toHaveBeenCalled();
    await expect(player.play()).rejects.toThrow(AudioDisposedError);
  });
});
