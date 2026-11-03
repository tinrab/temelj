import { describe, expect, it, vi } from "vitest";

import { createMockDecodeAudioContext, asNative } from "../../tests/audio.ts";
import {
  createAudioBufferFromChannels,
  isAudioBufferLoaded,
  isAudioBufferSourceTypeSupported,
  resolveAudioBuffer,
} from "../mod.ts";

describe("AudioBuffer source loading", () => {
  it("detects common AudioBuffer source types", () => {
    expect(isAudioBufferSourceTypeSupported("wav")).toBe(true);
    expect(isAudioBufferSourceTypeSupported("test.wav")).toBe(true);
    expect(isAudioBufferSourceTypeSupported("path/to/test.wav?version=1#clip")).toBe(true);
    expect(isAudioBufferSourceTypeSupported("audio/mpeg")).toBe(true);
    expect(isAudioBufferSourceTypeSupported(new URL("https://example.com/audio.flac"))).toBe(true);
    expect(isAudioBufferSourceTypeSupported("path/to/test.nope")).toBe(false);
    expect(isAudioBufferSourceTypeSupported("application/octet-stream")).toBe(false);
  });

  it("detects whether an AudioBuffer contains frames", () => {
    const context = createMockDecodeAudioContext();
    const loaded = createAudioBufferFromChannels([[1]], { sampleRate: context.sampleRate });
    expect(isAudioBufferLoaded(loaded)).toBe(true);
    // Decoders can hand back zero-frame buffers even though they cannot be constructed.
    expect(isAudioBufferLoaded(asNative<AudioBuffer>({ length: 0 }))).toBe(false);
  });

  it("resolves AudioBuffer sources directly or by loading data", async () => {
    const context = createMockDecodeAudioContext();
    const buffer = createAudioBufferFromChannels([[1, 0]], { sampleRate: context.sampleRate });
    const loaded = await resolveAudioBuffer(context, new Uint8Array([1, 2, 3]));

    await expect(resolveAudioBuffer(context, buffer)).resolves.toBe(buffer);
    expect(loaded.length).toBe(3);
  });

  it("resolves AudioBuffer sources with base URLs", async () => {
    const context = createMockDecodeAudioContext();
    const originalFetch = globalThis.fetch;

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      return asNative<Response>({
        arrayBuffer: async () => new ArrayBuffer(String(input).length),
        ok: true,
      });
    });

    globalThis.fetch = fetchMock;

    try {
      const loaded = await resolveAudioBuffer(context, "hat.wav", {
        baseUrl: "/samples",
      });

      expect(fetchMock).toHaveBeenCalledWith("/samples/hat.wav", undefined);
      expect(loaded.length).toBe("/samples/hat.wav".length);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("resolves AudioBuffer source candidate arrays with base URLs and fetch options", async () => {
    const context = createMockDecodeAudioContext();
    const originalFetch = globalThis.fetch;

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      return asNative<Response>({
        arrayBuffer: async () => new ArrayBuffer(String(input).length),
        ok: !String(input).endsWith("missing.wav"),
        status: 404,
      });
    });

    globalThis.fetch = fetchMock;

    try {
      const loaded = await resolveAudioBuffer(
        context,
        [
          {
            src: "missing.wav",
          },
          {
            fetch: { headers: { "x-sample": "hat" } },
            src: "hat.wav",
          },
        ],
        {
          baseUrl: "/samples",
          fetch: { method: "GET" },
        },
      );

      expect(fetchMock).toHaveBeenNthCalledWith(1, "/samples/missing.wav", {
        method: "GET",
      });
      const [url, init] = fetchMock.mock.calls[1] ?? [];
      expect(url).toBe("/samples/hat.wav");
      expect(init?.method).toBe("GET");
      expect(new Headers(init?.headers).get("x-sample")).toBe("hat");
      expect(loaded.length).toBe("/samples/hat.wav".length);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
