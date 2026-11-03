import { describe, expect, it } from "vitest";

import { asNative, MockAudioParam } from "../../tests/audio.ts";
import { applyAutomation, type AutomationEvent } from "../mod.ts";

describe("applyAutomation", () => {
  it("schedules events in order and returns the AudioParam", () => {
    const param = new MockAudioParam();
    const curve = new Float32Array([0, 0.5, 1]);

    const events: AutomationEvent[] = [
      { time: 1, type: "set", value: 0.25 },
      { time: 2, type: "linearRamp", value: 0.5 },
      { time: 3, type: "exponentialRamp", value: 1 },
      { time: 4, timeConstant: 0.2, type: "target", value: 0.75 },
      { duration: 0.5, time: 5, type: "curve", values: curve },
      { time: 6, type: "cancel" },
      { time: 7, type: "cancelAndHold" },
    ];

    expect(applyAutomation(asNative<AudioParam>(param), events)).toBe(param);

    const calls = [
      [param.setValueAtTime, [0.25, 1]],
      [param.linearRampToValueAtTime, [0.5, 2]],
      [param.exponentialRampToValueAtTime, [1, 3]],
      [param.setTargetAtTime, [0.75, 4, 0.2]],
      [param.setValueCurveAtTime, [curve, 5, 0.5]],
      [param.cancelScheduledValues, [6]],
      [param.cancelAndHoldAtTime, [7]],
    ] as const;

    let previousOrder = 0;

    for (const [method, args] of calls) {
      expect(method).toHaveBeenCalledWith(...args);
      const order = method.mock.invocationCallOrder[0] ?? 0;
      expect(order).toBeGreaterThan(previousOrder);
      previousOrder = order;
    }
  });
});
