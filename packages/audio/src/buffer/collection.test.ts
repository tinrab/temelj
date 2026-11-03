import { describe, expect, it, vi } from "vitest";

import { createMockAudioContext, MockAudioBuffer, asNative } from "../../tests/audio.ts";
import {
  AudioDisposedError,
  AudioGraphError,
  BufferCollection,
  createAudioBufferFromChannels,
} from "../mod.ts";

function createCollectionContext(sampleRate = 48_000): ReturnType<typeof createMockAudioContext> {
  const context = createMockAudioContext(0, sampleRate);
  context.decodeAudioData = vi.fn<(data: ArrayBuffer) => Promise<AudioBuffer>>(async (data) => {
    return asNative<AudioBuffer>(
      new MockAudioBuffer({
        length: data.byteLength,
        numberOfChannels: 1,
        sampleRate,
      }),
    );
  });

  return context;
}

describe("AudioBuffer collections", () => {
  it("stores named AudioBuffers in a collection", () => {
    const context = createCollectionContext();
    const kick = createAudioBufferFromChannels([[1, 0]], { sampleRate: context.sampleRate });
    const snare = createAudioBufferFromChannels([[0, 1]], { sampleRate: context.sampleRate });
    const collection = new BufferCollection(context);

    expect(collection.set("kick", kick)).toBe(collection);
    expect(collection.size).toBe(1);
    expect(collection.names).toEqual(["kick"]);
    expect(collection.has("kick")).toBe(true);
    expect(collection.get("kick")).toBe(kick);

    collection.set("snare", snare);
    expect(collection.names).toEqual(["kick", "snare"]);
    expect(collection.delete("kick")).toBe(true);
    expect(collection.has("kick")).toBe(false);
    expect(() => collection.get("kick")).toThrow(AudioGraphError);

    collection.clear();
    expect(collection.size).toBe(0);
  });

  it("loads collection entries from URL and data sources", async () => {
    const context = createCollectionContext();

    const collection = new BufferCollection(context, {
      baseUrl: "/samples/",
    });

    const originalFetch = globalThis.fetch;

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      return asNative<Response>({
        arrayBuffer: async () => new ArrayBuffer(String(input).length),
        ok: true,
      });
    });

    globalThis.fetch = fetchMock;

    try {
      const addResult = await collection.add("hat", "hat.wav");
      await collection.add("inline", new Uint8Array([1, 2, 3]));

      expect(addResult).toBe(collection.get("hat"));
      expect(collection.loaded).toBe(true);
      expect(collection.get("hat").length).toBe("/samples/hat.wav".length);
      expect(collection.get("inline").length).toBe(3);
      expect(fetchMock).toHaveBeenCalledWith("/samples/hat.wav", undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("normalizes collection base URLs when loading relative sources", async () => {
    const context = createCollectionContext();

    const collection = new BufferCollection(context, {
      baseUrl: "/samples",
    });

    const originalFetch = globalThis.fetch;

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      return asNative<Response>({
        arrayBuffer: async () => new ArrayBuffer(String(input).length),
        ok: true,
      });
    });

    globalThis.fetch = fetchMock;

    try {
      await collection.add("hat", "hat.wav");

      expect(fetchMock).toHaveBeenCalledWith("/samples/hat.wav", undefined);
      expect(collection.get("hat").length).toBe("/samples/hat.wav".length);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not prefix absolute collection sources", async () => {
    const context = createCollectionContext();

    const collection = new BufferCollection(context, {
      baseUrl: "/samples",
    });

    const originalFetch = globalThis.fetch;

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      return asNative<Response>({
        arrayBuffer: async () => new ArrayBuffer(String(input).length),
        ok: true,
      });
    });

    globalThis.fetch = fetchMock;

    try {
      await collection.add("rooted", "/rooted.wav");
      await collection.add("remote", "https://example.com/remote.wav");

      expect(fetchMock).toHaveBeenNthCalledWith(1, "/rooted.wav", undefined);
      expect(fetchMock).toHaveBeenNthCalledWith(2, "https://example.com/remote.wav", undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("loads every source with BufferCollection.load()", async () => {
    const context = createCollectionContext();
    const inline = createAudioBufferFromChannels([[1]], { sampleRate: context.sampleRate });

    const collection = await BufferCollection.load(context, {
      bytes: new Uint8Array([1, 2]),
      inline,
    });

    expect([...collection.names].toSorted()).toEqual(["bytes", "inline"]);
    expect(collection.get("inline")).toBe(inline);
    expect(collection.loaded).toBe(true);
    await collection.ready();
  });

  it("rejects collection use after disposal", async () => {
    const context = createCollectionContext();
    const buffer = createAudioBufferFromChannels([[1]], { sampleRate: context.sampleRate });
    const collection = new BufferCollection(context);

    collection.set("tone", buffer);
    expect(collection.disposed).toBe(false);

    collection.dispose();
    collection.dispose();

    expect(collection.disposed).toBe(true);
    expect(collection.size).toBe(0);
    expect(() => collection.set("tone", buffer)).toThrow(AudioDisposedError);
    expect(() => collection.get("tone")).toThrow(AudioDisposedError);
    await expect(collection.add("tone", buffer)).rejects.toThrow(AudioDisposedError);
  });
});
