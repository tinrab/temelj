import { describe, expect, it, vi } from "vitest";

import { createMockAudioBuffer, createMockAudioContext } from "../../tests/audio.ts";
import { Playlist, player } from "../mod.ts";

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("Playlist", () => {
  it("plays tracks sequentially and forwards start options", async () => {
    const context = createMockAudioContext();
    const first = player({ buffer: createMockAudioBuffer() });
    const second = player({ buffer: createMockAudioBuffer() });

    const playlist = new Playlist({
      context,
      tracks: [first, second],
    });

    expect(playlist.length).toBe(2);
    expect(playlist.length).toBe(2);
    expect(playlist.disposed).toBe(false);
    expect(playlist.state).toBe("stopped");
    expect(playlist.state).toBe("stopped");

    const firstHandle = playlist.play(0, { at: 3, duration: 0.25, offset: 0.5 });
    const firstSource = context.createdSources[0]!;

    expect(playlist.state).toBe("started");
    expect(playlist.state).toBe("started");
    expect(playlist.currentIndex).toBe(0);
    expect(playlist.currentTrack?.player).toBe(first);
    expect(firstSource.start).toHaveBeenCalledWith(3, 0.5, 0.25);

    firstSource.dispatchEnded();
    await flushMicrotasks();

    expect(playlist.currentIndex).toBe(1);
    expect(playlist.currentTrack?.player).toBe(second);
    expect(
      context.createdSources.slice(1).some((source) => source.start.mock.calls.length > 0),
    ).toBe(true);

    firstHandle.dispose();
    playlist.dispose();
  });

  it("loops from the final track back to the first track", async () => {
    const context = createMockAudioContext();
    const first = player({ buffer: createMockAudioBuffer() });
    const second = player({ buffer: createMockAudioBuffer() });

    const playlist = new Playlist({
      context,
      loop: true,
      tracks: [first, second],
    });

    playlist.play(1);
    context.createdSources[0]?.dispatchEnded();
    await flushMicrotasks();

    expect(playlist.currentIndex).toBe(0);
    expect(playlist.currentTrack?.player).toBe(first);
    expect(context.createdSources[1]?.start).toHaveBeenCalledWith(1, 0);

    playlist.dispose();
  });

  it("forwards pause, seek, stop, and dispose to the active handle", async () => {
    const context = createMockAudioContext();
    const track = player({ buffer: createMockAudioBuffer() });
    const playlist = new Playlist({ context, tracks: [track] });

    playlist.play(0);
    const source = context.createdSources[0]!;

    playlist.pause(4);
    playlist.seek(0.25);
    playlist.stop(5);

    expect(source.stop).toHaveBeenCalledWith(4);
    expect(playlist.currentIndex).toBe(0);
    expect(playlist.state).toBe("stopped");
    expect(playlist.state).toBe("stopped");

    playlist.play(0);
    const nextSource = context.createdSources[1]!;
    playlist.dispose();
    playlist.dispose();

    expect(nextSource.stop).toHaveBeenCalled();
    expect(nextSource.disconnect).toHaveBeenCalled();
    expect(playlist.currentIndex).toBe(-1);
    expect(playlist.disposed).toBe(true);
    expect(playlist.state).toBe("stopped");
    expect(playlist.state).toBe("stopped");
  });

  it("updates current index when tracks are removed or cleared", async () => {
    const context = createMockAudioContext();
    const first = player({ buffer: createMockAudioBuffer() });
    const second = player({ buffer: createMockAudioBuffer() });
    const third = player({ buffer: createMockAudioBuffer() });

    const playlist = new Playlist({
      context,
      tracks: [first, second, third],
    });

    playlist.play(2);

    expect(playlist.length).toBe(3);
    expect(playlist.length).toBe(3);
    expect(playlist.remove(1)?.player).toBe(second);
    expect(playlist.length).toBe(2);
    expect(playlist.length).toBe(2);
    expect(playlist.currentIndex).toBe(1);
    expect(playlist.currentTrack?.player).toBe(third);

    expect(playlist.remove(1)?.player).toBe(third);
    expect(playlist.length).toBe(1);
    expect(playlist.length).toBe(1);
    expect(playlist.currentIndex).toBe(-1);
    expect(playlist.currentTrack).toBeUndefined();

    playlist.add(first).add(second);
    expect(playlist.length).toBe(3);
    expect(playlist.length).toBe(3);
    expect(playlist.tracks.map((track) => track.player)).toEqual([first, first, second]);

    playlist.clear();
    expect(playlist.length).toBe(0);
    expect(playlist.length).toBe(0);
    expect(playlist.tracks).toEqual([]);
    expect(playlist.currentIndex).toBe(-1);
  });

  it("uses weighted shuffle selection", async () => {
    const context = createMockAudioContext();
    const first = player({ buffer: createMockAudioBuffer() });
    const second = player({ buffer: createMockAudioBuffer() });
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.9);

    const playlist = new Playlist({
      context,
      shuffle: true,
      tracks: [
        { player: first, weight: 0 },
        { player: second, weight: 1 },
      ],
    });

    playlist.play();

    expect(playlist.currentIndex).toBe(1);
    expect(playlist.currentTrack?.player).toBe(second);

    randomSpy.mockRestore();
    playlist.dispose();
  });
});
