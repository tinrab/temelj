import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { asNative } from "../../tests/audio.ts";
import { GlobalMockOfflineAudioContext, installContextTestGlobals } from "../../tests/context.ts";
import { destination, oscillator } from "../graph/blueprint.ts";
import { renderOffline } from "./offline.ts";

let restoreGlobals: () => void;

const createdContexts: GlobalMockOfflineAudioContext[] = [];

beforeEach(() => {
  restoreGlobals = installContextTestGlobals();
  createdContexts.length = 0;

  const OfflineContext = class extends GlobalMockOfflineAudioContext {
    readonly options: OfflineAudioContextOptions | undefined;

    constructor(options?: OfflineAudioContextOptions) {
      super(options);
      this.options = options;
      createdContexts.push(this);
    }
  };

  vi.stubGlobal("OfflineAudioContext", OfflineContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
  restoreGlobals();
});

describe("renderOffline", () => {
  it("renders the graph after setup starts its sources", async () => {
    const source = oscillator();
    const output = destination();
    source.connect(output);

    const buffer = await renderOffline(
      { destination: output, duration: 0.5, sampleRate: 8_000 },
      ({ start }) => {
        start(source, { time: 0 });
      },
    );

    expect(buffer).toEqual({ duration: 0 });
    expect(createdContexts.at(-1)?.startRendering).toHaveBeenCalledOnce();
    expect(createdContexts.at(-1)?.createdOscillators[0]?.start).toHaveBeenCalledWith(0);
    expect(
      asNative<{ options: OfflineAudioContextOptions }>(createdContexts.at(-1) ?? {}).options,
    ).toEqual({
      length: 4_000,
      numberOfChannels: 2,
      sampleRate: 8_000,
    });
  });

  it("does not add a frame for floating-point error in the duration", async () => {
    const output = destination();

    // `0.07 * 44_100` is `3087.0000000000005`, which `Math.ceil` alone turns into 3088.
    await renderOffline(
      { destination: output, duration: 0.07, sampleRate: 44_100 },
      () => undefined,
    );

    expect(
      asNative<{ options: OfflineAudioContextOptions }>(createdContexts.at(-1) ?? {}).options
        .length,
    ).toBe(3087);
  });

  it("awaits async setup and disconnects nodes afterwards", async () => {
    const source = oscillator();
    const output = destination();
    source.connect(output);
    const order: string[] = [];

    await renderOffline({ destination: output, duration: 1 }, async () => {
      await Promise.resolve();
      order.push("setup");
    });
    order.push("rendered");

    expect(order).toEqual(["setup", "rendered"]);
    expect(createdContexts.at(-1)?.createdOscillators[0]?.disconnect).toHaveBeenCalled();
  });

  it("cleans up when setup or rendering fails", async () => {
    const output = destination();
    oscillator().connect(output);

    await expect(
      renderOffline({ destination: output, duration: 1 }, () => {
        throw new Error("setup failed");
      }),
    ).rejects.toThrow("setup failed");
    expect(createdContexts.at(-1)?.createdOscillators[0]?.disconnect).toHaveBeenCalled();
  });

  it("rejects invalid durations and channel counts", async () => {
    const output = destination();

    await expect(
      renderOffline({ destination: output, duration: 0 }, () => undefined),
    ).rejects.toThrow("duration");
    await expect(
      renderOffline({ destination: output, duration: 1, numberOfChannels: 1.5 }, () => undefined),
    ).rejects.toThrow("numberOfChannels");
  });
});
