import { describe, expect, it } from "vitest";

import {
  createMockAudioBuffer as createMockBuffer,
  createMockAudioContext as createMockContext,
  type MockBufferSourceNode,
  type MockGainNode,
  asMock,
} from "../../tests/audio.ts";
import { AudioGraphError, Player, Players } from "../mod.ts";

describe("audio players bank", () => {
  it("creates named players and routes each one into a shared output", () => {
    const context = createMockContext(2);

    const buffers = {
      kick: createMockBuffer(1),
      snare: createMockBuffer(2),
    };

    const players = new Players<string>(context, buffers, {
      fadeIn: 0.01,
      fadeOut: 0.05,
      mute: true,
      volume: 0.75,
    });

    const output = asMock<MockGainNode>(players.output);

    expect(players.names).toEqual(["kick", "snare"]);
    expect(players.disposed).toBe(false);
    expect(players.mute).toBe(true);
    expect(players.size).toBe(2);
    expect(players.state).toBe("stopped");
    expect(players.has("kick")).toBe(true);
    expect(players.has("hat")).toBe(false);
    expect(output.gain.value).toBe(0);
    players.setMute(false, 3);
    expect(players.mute).toBe(false);
    expect(output.gain.setValueAtTime).toHaveBeenCalledWith(0.75, 3);
    players.setVolume(0.5, 4);
    expect(output.gain.setValueAtTime).toHaveBeenCalledWith(0.5, 4);
    players.setMute(true, 5);
    expect(players.mute).toBe(true);
    expect(output.gain.setValueAtTime).toHaveBeenCalledWith(0, 5);
    players.setVolume(0.25, 6);
    expect(output.gain.setValueAtTime).toHaveBeenCalledWith(0, 6);
    players.setMute(false, 7);
    expect(output.gain.setValueAtTime).toHaveBeenCalledWith(0.25, 7);
    expect(() => players.setVolume(-1)).toThrow("volume");
    expect(players.player("kick").fadeIn).toBe(0.01);
    expect(players.player("snare").fadeOut).toBe(0.05);
    expect(asMock<MockGainNode>(players.player("kick").output).connect).toHaveBeenCalledWith(
      output,
    );
    expect(asMock<MockGainNode>(players.player("snare").output).connect).toHaveBeenCalledWith(
      output,
    );
  });

  it("propagates shared fade settings and stops every active player", () => {
    const context = createMockContext(2);

    const players = new Players(context, {
      kick: createMockBuffer(1),
      snare: createMockBuffer(1),
    });

    players.setFadeIn(0.02);
    players.setFadeOut(0.1);

    expect(players.fadeIn).toBe(0.02);
    expect(players.fadeOut).toBe(0.1);
    expect(players.player("kick").fadeIn).toBe(0.02);
    expect(players.player("snare").fadeOut).toBe(0.1);

    const kick = players.player("kick").start({ time: 3 });
    const snare = players.player("snare").start({ time: 3.5 });
    expect(players.state).toBe("started");
    players.stopAll(4);

    expect(asMock<MockBufferSourceNode>(kick.source).stop).toHaveBeenCalledWith(4.1);
    expect(asMock<MockBufferSourceNode>(snare.source).stop).toHaveBeenCalledWith(4.1);
    expect(players.state).toBe("stopped");
  });

  it("adds, replaces, removes, and disposes players", () => {
    const context = createMockContext(2);

    const players = new Players<string>(context, {
      kick: createMockBuffer(1),
    });

    const firstKick = players.player("kick");
    const replacement = new Player(context, createMockBuffer(1));
    const hat = new Player(context, createMockBuffer(1));
    const firstKickOutput = asMock<MockGainNode>(firstKick.output);
    const hatOutput = asMock<MockGainNode>(hat.output);
    const replacementOutput = asMock<MockGainNode>(replacement.output);

    players.add("kick", replacement);
    players.add("hat", hat);

    expect(firstKickOutput.disconnect).toHaveBeenCalledTimes(1);
    expect(players.player("kick")).toBe(replacement);
    expect(players.names).toEqual(["kick", "hat"]);
    expect(players.size).toBe(2);

    const removed = players.remove("hat");

    expect(removed).toBe(hat);
    expect(hatOutput.disconnect).toHaveBeenCalledTimes(1);
    expect(players.has("hat")).toBe(false);
    expect(players.size).toBe(1);
    expect(players.remove("hat")).toBeUndefined();
    expect(() => players.player("hat")).toThrow(AudioGraphError);

    players.dispose();
    players.dispose();

    expect(players.disposed).toBe(true);
    expect(players.names).toEqual([]);
    expect(players.size).toBe(0);
    expect(players.state).toBe("stopped");
    expect(asMock<MockGainNode>(players.output).disconnect).toHaveBeenCalledTimes(1);
    expect(replacementOutput.disconnect).toHaveBeenCalledTimes(1);
  });

  it("adds players from decoded buffers and loadable sources", async () => {
    const context = createMockContext(2);

    const players = new Players<string>(context, {
      kick: createMockBuffer(1),
    });

    players.setFadeIn(0.02);
    players.setFadeOut(0.1);

    const snare = players.addBuffer("snare", createMockBuffer(2));
    const hat = await players.addSource("hat", createMockBuffer(3));

    expect(players.names).toEqual(["kick", "snare", "hat"]);
    expect(players.size).toBe(3);
    expect(players.player("snare")).toBe(snare);
    expect(players.player("hat")).toBe(hat);
    expect(snare.fadeIn).toBe(0.02);
    expect(snare.fadeOut).toBe(0.1);
    expect(hat.fadeIn).toBe(0.02);
    expect(hat.fadeOut).toBe(0.1);
    expect(asMock<MockGainNode>(snare.output).connect).toHaveBeenCalledWith(players.output);
    expect(asMock<MockGainNode>(hat.output).connect).toHaveBeenCalledWith(players.output);
  });
});
