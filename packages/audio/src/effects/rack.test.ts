import { describe, expect, it } from "vitest";

import { createMockAudioContext, MockAudioParam, MockGainNode, asMock } from "../../tests/audio.ts";
import { AudioDisposedError } from "../errors.ts";
import { DubDelay, EffectRack, Quadrafuzz } from "../mod.ts";

describe("EffectRack", () => {
  it("preserves order when adding and removing effects", () => {
    const context = createMockAudioContext();
    const first = new DubDelay(context);
    const second = new Quadrafuzz(context);
    const third = new DubDelay(context);
    const rack = new EffectRack(context, [first, third]);

    rack.add(second, 1);

    expect(rack.effects).toEqual([first, second, third]);
    expect(asMock<MockGainNode>(rack.input).connect.mock.calls.at(-1)).toEqual([
      expect.objectContaining({ gain: expect.any(MockAudioParam) }),
    ]);
    expect(rack.remove(second)).toBe(true);
    expect(rack.remove(second)).toBe(false);
    expect(rack.effects).toEqual([first, third]);
    expect(asMock<MockGainNode>(second.input).disconnect).not.toHaveBeenCalled();
    // Only the link into the rack is removed; other connections of the effect are left alone.
    expect(asMock<MockGainNode>(second.output).disconnect.mock.calls).toEqual([
      [expect.any(MockGainNode)],
    ]);

    rack.clear();

    expect(rack.effects).toEqual([]);
    expect(asMock<MockGainNode>(rack.input).connect.mock.calls.at(-1)).toEqual([rack.output]);

    rack.dispose();
    rack.dispose();

    expect(rack.disposed).toBe(true);
    expect(() => rack.add(first)).toThrow(AudioDisposedError);
  });
});
