import { afterAll, describe, expect, it } from "vitest";

import {
  createMockAudioContext,
  MockAudioWorkletNode,
  patchGlobal,
  asMock,
  MockAudioNode,
} from "../../tests/audio.ts";
import { ReverseDelay } from "../mod.ts";

const restoreWorkletNode = patchGlobal("AudioWorkletNode", MockAudioWorkletNode);

afterAll(() => {
  restoreWorkletNode();
});

describe("ReverseDelay", () => {
  it("builds a worklet-backed reverse delay", async () => {
    const context = createMockAudioContext(3);

    const reverseDelay = await ReverseDelay.create(context, {
      delayTime: 0.25,
      feedback: 0.4,
      wet: 0.75,
      workletUrl: "reverse-delay.js",
    });

    const worklet = asMock<MockAudioWorkletNode>(reverseDelay.worklet);

    expect(context.audioWorklet.addModule.mock.calls[0]?.[0]).toBe("reverse-delay.js");
    expect(worklet.name).toBe("temelj-reverse-delay");
    expect(worklet.options.processorOptions).toEqual({ delayTime: 0.25 });
    expect(worklet.connect).toHaveBeenCalledWith(reverseDelay.wetGain);
    expect(reverseDelay.wet.value).toBe(0.75);
    expect(reverseDelay.feedback.value).toBe(0.4);

    reverseDelay.setFeedback(2, 4);
    expect(reverseDelay.feedback.value).toBe(1);

    reverseDelay.dispose();
    reverseDelay.dispose();
    expect(worklet.disconnect).toHaveBeenCalledTimes(1);
  });

  it("replaces the worklet when the delay time changes", async () => {
    const context = createMockAudioContext(3);

    const reverseDelay = await ReverseDelay.create(context, {
      delayTime: 0.25,
      feedback: 0.25,
      workletUrl: "reverse-delay.js",
    });

    const first = asMock<MockAudioWorkletNode>(reverseDelay.worklet);

    await reverseDelay.setDelayTime(0.5);
    const next = asMock<MockAudioWorkletNode>(reverseDelay.worklet);

    expect(reverseDelay.delayTime).toBe(0.5);
    expect(first.disconnect).toHaveBeenCalled();
    expect(asMock<MockAudioNode>(reverseDelay.input).disconnect).toHaveBeenCalledWith(first);
    expect(next.options.processorOptions).toEqual({ delayTime: 0.5 });
    expect(next.options.parameterData).toEqual({ feedback: 0.25 });
  });
});
