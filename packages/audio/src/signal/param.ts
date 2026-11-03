import { AudioRangeError } from "../errors.ts";
import { clampNormal } from "../validation.ts";

export type ParamUnit = "decibels" | "hertz" | "normalRange" | "seconds";

export interface Param<TUnit extends ParamUnit = "normalRange"> {
  readonly unit: TUnit;
  toAudioValue(value: number): number;
  fromAudioValue(value: number): number;
  getValueAtTime(time: number): number;
  setValueAtTime(value: number, time: number): this;
  setRampPoint(time?: number): this;
  linearRampToValueAtTime(value: number, time: number): this;
  exponentialRampToValueAtTime(value: number, time: number): this;
  linearRampTo(value: number, duration: number, time?: number): this;
  exponentialRampTo(value: number, duration: number, time?: number): this;
  setTargetAtTime(target: number, startTime: number, timeConstant: number): this;
  cancelScheduledValues(time: number): this;
  cancelAndHoldAtTime(time: number): this;
  rampTo(value: number, duration: number, time?: number): this;
  targetRampTo(target: number, timeConstant: number, time?: number): this;
}

type BaseAutomationEvent = {
  time: number;
};

type SetValueEvent = BaseAutomationEvent & {
  kind: "set";
  value: number;
};

type LinearRampEvent = BaseAutomationEvent & {
  kind: "linear";
  startTime: number;
  startValue: number;
  value: number;
};

type ExponentialRampEvent = BaseAutomationEvent & {
  kind: "exponential";
  startTime: number;
  startValue: number;
  value: number;
};

type TargetEvent = BaseAutomationEvent & {
  kind: "target";
  value: number;
  startValue: number;
  timeConstant: number;
};

type ParamEvent = SetValueEvent | LinearRampEvent | ExponentialRampEvent | TargetEvent;

/**
 * Converts a user-facing value to the native `AudioParam` value. Only decibels differ.
 */
function toUnitValue(unit: ParamUnit, value: number): number {
  return unit === "decibels" ? dbToGain(value) : value;
}

function fromUnitValue(unit: ParamUnit, value: number): number {
  return unit === "decibels" ? gainToDb(value) : value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

class AudioParamHandle<TUnit extends ParamUnit = "normalRange"> implements Param<TUnit> {
  #events: ParamEvent[] = [];
  readonly #unit: TUnit;
  #contextNow: () => number;
  readonly audioParam: AudioParam;

  constructor(audioParam: AudioParam, unit: TUnit, options: { now?: () => number } = {}) {
    this.audioParam = audioParam;
    this.#unit = unit;
    this.#contextNow = options.now ?? (() => 0);
  }

  get unit(): TUnit {
    return this.#unit;
  }

  toAudioValue(value: number): number {
    return clamp(toUnitValue(this.#unit, value), -3.4e38, 3.4e38);
  }

  fromAudioValue(value: number): number {
    return fromUnitValue(this.#unit, value);
  }

  #pushEvent(event: ParamEvent): void {
    this.#events.push(event);
    this.#events.sort((left, right) => left.time - right.time);
  }

  #interpolateLinear(event: Omit<LinearRampEvent, "kind">, time: number): number {
    const duration = event.time - event.startTime;

    if (duration <= 0) {
      return event.value;
    }

    const ratio = (time - event.startTime) / duration;

    return event.startValue + (event.value - event.startValue) * clamp(ratio, 0, 1);
  }

  #interpolateExponential(event: Omit<ExponentialRampEvent, "kind">, time: number): number {
    const duration = event.time - event.startTime;

    if (duration <= 0) {
      return event.value;
    }

    if (event.startValue <= 0 || event.value <= 0) {
      return event.value;
    }

    const ratio = (time - event.startTime) / duration;
    const clamped = clamp(ratio, 0, 1);

    return event.startValue * (event.value / event.startValue) ** clamped;
  }

  #evaluateTarget(event: TargetEvent, time: number): number {
    if (time <= event.time) {
      return event.startValue;
    }

    if (event.timeConstant <= 0) {
      return event.value;
    }

    const elapsed = time - event.time;

    return (
      event.startValue + (event.value - event.startValue) * Math.exp(-elapsed / event.timeConstant)
    );
  }

  #getAudioValueAtTime(time: number): number {
    if (this.#events.length === 0) {
      return this.audioParam.value;
    }

    let activeEvent: ParamEvent | undefined;

    for (const event of this.#events) {
      if (event.time > time) {
        if ((event.kind === "linear" || event.kind === "exponential") && time >= event.startTime) {
          if (event.kind === "linear") {
            return this.#interpolateLinear(event, time);
          }

          return this.#interpolateExponential(event, time);
        }

        break;
      }

      activeEvent = event;
    }

    if (!activeEvent) {
      return this.audioParam.value;
    }

    if (activeEvent.kind === "target") {
      return this.#evaluateTarget(activeEvent, time);
    }

    if (
      (activeEvent.kind === "linear" || activeEvent.kind === "exponential") &&
      time >= activeEvent.startTime
    ) {
      if (activeEvent.kind === "linear") {
        return this.#interpolateLinear(activeEvent, time);
      }

      return this.#interpolateExponential(activeEvent, time);
    }

    return activeEvent.value;
  }

  #pushSetPoint(value: number, time: number): void {
    this.#pushEvent({
      kind: "set",
      time,
      value,
    });
  }

  #linearRampFrom(value: number, startTime: number, endTime: number): this {
    const audioValue = this.toAudioValue(value);
    const startValue = this.toAudioValue(this.getValueAtTime(startTime));

    if (this.audioParam.linearRampToValueAtTime instanceof Function) {
      this.audioParam.linearRampToValueAtTime(audioValue, endTime);
    }

    this.#pushEvent({
      kind: "linear",
      time: endTime,
      startTime,
      startValue,
      value: audioValue,
    });

    return this;
  }

  #exponentialRampFrom(value: number, startTime: number, endTime: number): this {
    const audioValue = this.toAudioValue(value);
    const startValue = this.toAudioValue(this.getValueAtTime(startTime));

    if (this.audioParam.exponentialRampToValueAtTime instanceof Function) {
      this.audioParam.exponentialRampToValueAtTime(audioValue, endTime);
    }

    this.#pushEvent({
      kind: "exponential",
      time: endTime,
      startTime,
      startValue,
      value: audioValue,
    });

    return this;
  }

  getValueAtTime(time: number): number {
    return this.fromAudioValue(this.#getAudioValueAtTime(time));
  }

  setValueAtTime(value: number, time: number): this {
    const audioValue = this.toAudioValue(value);

    this.audioParam.setValueAtTime(audioValue, time);

    this.#pushSetPoint(audioValue, time);

    return this;
  }

  setRampPoint(time = this.#contextNow()): this {
    const audioValue = this.toAudioValue(this.getValueAtTime(time));

    if (this.audioParam.cancelAndHoldAtTime instanceof Function) {
      this.audioParam.cancelAndHoldAtTime(time);
    } else if (this.audioParam.cancelScheduledValues instanceof Function) {
      this.audioParam.cancelScheduledValues(time);
      this.audioParam.setValueAtTime(audioValue, time);
    } else if (this.audioParam.setValueAtTime instanceof Function) {
      this.audioParam.setValueAtTime(audioValue, time);
    }

    this.#events = this.#events.filter((event) => event.time < time);
    this.#pushEvent({
      kind: "set",
      time,
      value: audioValue,
    });

    return this;
  }

  linearRampToValueAtTime(value: number, time: number): this {
    const startTime = this.#contextNow();

    return this.#linearRampFrom(value, startTime, time);
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    const startTime = this.#contextNow();

    return this.#exponentialRampFrom(value, startTime, time);
  }

  linearRampTo(value: number, duration: number, time = this.#contextNow()): this {
    this.setRampPoint(time);

    return this.#linearRampFrom(value, time, time + duration);
  }

  exponentialRampTo(value: number, duration: number, time = this.#contextNow()): this {
    this.setRampPoint(time);

    return this.#exponentialRampFrom(value, time, time + duration);
  }

  setTargetAtTime(target: number, startTime: number, timeConstant: number): this {
    const convertedTarget = this.toAudioValue(target);
    const startValue = this.toAudioValue(this.getValueAtTime(startTime));

    if (this.audioParam.setTargetAtTime instanceof Function) {
      this.audioParam.setTargetAtTime(convertedTarget, startTime, timeConstant);
    }

    this.#pushEvent({
      kind: "target",
      time: startTime,
      value: convertedTarget,
      startValue,
      timeConstant,
    });

    return this;
  }

  cancelAndHoldAtTime(time: number): this {
    const audioValue = this.toAudioValue(this.getValueAtTime(time));

    if (this.audioParam.cancelAndHoldAtTime instanceof Function) {
      this.audioParam.cancelAndHoldAtTime(time);
    } else if (this.audioParam.cancelScheduledValues instanceof Function) {
      this.audioParam.cancelScheduledValues(time);
      this.audioParam.setValueAtTime(audioValue, time);
    }

    this.#events = this.#events.filter((event) => event.time < time);
    this.#pushSetPoint(audioValue, time);

    return this;
  }

  cancelScheduledValues(time: number): this {
    if (this.audioParam.cancelScheduledValues instanceof Function) {
      this.audioParam.cancelScheduledValues(time);
    }

    this.#events = this.#events.filter((event) => event.time < time);

    return this;
  }

  rampTo(value: number, duration: number, time = this.#contextNow()): this {
    if (this.unit === "hertz" || this.unit === "decibels") {
      return this.exponentialRampTo(value, duration, time);
    }

    return this.linearRampTo(value, duration, time);
  }

  targetRampTo(target: number, timeConstant: number, time = this.#contextNow()): this {
    this.setTargetAtTime(target, time, timeConstant);

    return this;
  }

  set value(value: number) {
    this.setValueAtTime(value, this.#contextNow());
  }
}

/**
 * Wraps an `AudioParam` with unit conversion. The wrapper keeps its own copy of the automation it
 * schedules, so `getValueAtTime()` can answer for any time. The unit defaults to `"normalRange"`.
 */
export function createParam(audioParam: AudioParam): Param<"normalRange">;

export function createParam<TUnit extends ParamUnit>(
  audioParam: AudioParam,
  unit: TUnit,
  now?: () => number,
): Param<TUnit>;

export function createParam(
  audioParam: AudioParam,
  unit: ParamUnit = "normalRange",
  now: () => number = () => 0,
): Param<ParamUnit> {
  return new AudioParamHandle(audioParam, unit, { now });
}

/**
 * Converts decibels to linear gain. `-Infinity` dB is silence.
 *
 * @throws {AudioRangeError} When `value` is `NaN`.
 */
export function dbToGain(value: number): number {
  if (Number.isNaN(value)) {
    return AudioRangeError.notFinite("decibels", value);
  }

  return 10 ** (value / 20);
}

/**
 * Converts linear gain to decibels. Zero or negative gain is `-Infinity` dB.
 *
 * @throws {AudioRangeError} When `value` is `NaN`.
 */
export function gainToDb(value: number): number {
  if (Number.isNaN(value)) {
    return AudioRangeError.notFinite("gain", value);
  }

  return value <= 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(value);
}

/**
 * Maps a 0–1 fade position to an equal-power gain, `sin(value × π / 2)`. Values outside 0–1 are
 * clamped.
 */
export function equalPowerScale(value: number): number {
  return Math.sin(clampNormal(value, "value") * 0.5 * Math.PI);
}
