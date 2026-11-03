import { describe, expect, it } from "vitest";

import { createMockAudioContext, asMock, MockAudioNode } from "../../tests/audio.ts";
import { DubDelay, PingPongDelay } from "../mod.ts";

describe("PingPongDelay", () => {
  it("alternates two panned delay lines in a feedback loop", () => {
    const context = createMockAudioContext(2);

    const pingPong = new PingPongDelay(context, {
      delayTime: 0.125,
      feedback: 0.4,
      maxDelayTime: 2,
      wet: 0.75,
    });

    expect(context.createdDelays).toHaveLength(2);
    const [left, right] = context.createdDelays;
    const [leftPanner, rightPanner] = context.createdPanners;

    expect(left!.connect).toHaveBeenCalledWith(leftPanner);
    expect(left!.connect).toHaveBeenCalledWith(right);
    expect(right!.connect).toHaveBeenCalledWith(rightPanner);

    // The right line feeds back into the left one through the feedback gain, closing the loop
    // so echoes keep alternating.
    const feedbackGain = asMock<MockAudioNode>(right!.connect.mock.calls[1]![0]);
    expect(feedbackGain.connect).toHaveBeenCalledWith(left);
    expect(leftPanner!.pan.value).toBe(-1);
    expect(rightPanner!.pan.value).toBe(1);
    expect(pingPong.delayTime.value).toBe(0.125);
    expect(pingPong.feedback.value).toBe(0.4);
    expect(pingPong.wet.value).toBe(0.75);

    pingPong.setDelayTime(0.25, 3);

    for (const delay of context.createdDelays) {
      expect(delay.delayTime.setValueAtTime.mock.calls.at(-1)).toEqual([0.25, 3]);
    }

    pingPong.setFeedback(2, 4);
    expect(pingPong.feedback.value).toBe(1);

    pingPong.dispose();
    pingPong.dispose();

    for (const node of [...context.createdDelays, ...context.createdPanners]) {
      expect(node.disconnect).toHaveBeenCalledTimes(1);
    }
  });
});

describe("DubDelay", () => {
  it("filters the feedback loop and mixes dry and wet", () => {
    const context = createMockAudioContext(3);

    const dubDelay = new DubDelay(context, {
      cutoff: 1_200,
      delayTime: 0.35,
      feedback: 0.45,
      maxDelayTime: 2,
      mix: 0.25,
    });

    expect(asMock<MockAudioNode>(dubDelay.delay).connect).toHaveBeenCalledWith(dubDelay.filter);
    expect(dubDelay.delayTime.value).toBe(0.35);
    expect(dubDelay.cutoff.value).toBe(1_200);
    expect(dubDelay.feedback.value).toBe(0.45);

    dubDelay.setMix(0.8, 7);
    expect(dubDelay.mix).toBe(0.8);
    const [, , dry, wet] = context.createdGains;
    expect(dry!.gain.setValueAtTime.mock.calls.at(-1)).toEqual([0.19999999999999996, 7]);
    expect(wet!.gain.setValueAtTime.mock.calls.at(-1)).toEqual([0.8, 7]);

    dubDelay.dispose();
    expect(dubDelay.disposed).toBe(true);
    expect(context.createdDelays[0]!.disconnect).toHaveBeenCalledTimes(1);
  });
});
