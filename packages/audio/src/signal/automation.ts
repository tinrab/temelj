/**
 * One declarative `AudioParam` automation step. `time` is the start time for value changes and the
 * end time for ramps, matching the native `AudioParam` methods.
 */
export type AutomationEvent =
  | { readonly type: "set"; readonly value: number; readonly time: number }
  | { readonly type: "linearRamp"; readonly value: number; readonly time: number }
  | { readonly type: "exponentialRamp"; readonly value: number; readonly time: number }
  | {
      readonly type: "target";
      readonly value: number;
      readonly time: number;
      readonly timeConstant: number;
    }
  | {
      readonly type: "curve";
      readonly values: Float32Array;
      readonly time: number;
      readonly duration: number;
    }
  | { readonly type: "cancel"; readonly time: number }
  | { readonly type: "cancelAndHold"; readonly time: number };

/**
 * Schedules automation events on an `AudioParam` in order.
 */
export function applyAutomation(
  audioParam: AudioParam,
  events: readonly AutomationEvent[],
): AudioParam {
  for (const event of events) {
    switch (event.type) {
      case "set": {
        audioParam.setValueAtTime(event.value, event.time);
        break;
      }

      case "linearRamp": {
        audioParam.linearRampToValueAtTime(event.value, event.time);
        break;
      }

      case "exponentialRamp": {
        audioParam.exponentialRampToValueAtTime(event.value, event.time);
        break;
      }

      case "target": {
        audioParam.setTargetAtTime(event.value, event.time, event.timeConstant);
        break;
      }

      case "curve": {
        audioParam.setValueCurveAtTime(event.values, event.time, event.duration);
        break;
      }

      case "cancel": {
        audioParam.cancelScheduledValues(event.time);
        break;
      }

      case "cancelAndHold": {
        audioParam.cancelAndHoldAtTime(event.time);
        break;
      }
    }
  }

  return audioParam;
}
