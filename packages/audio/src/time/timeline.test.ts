import { describe, expect, expectTypeOf, it } from "vitest";

import type { PlaybackState } from "../unit.ts";

import {
  IntervalTimeline,
  StateTimeline,
  Timeline,
  TimelineValue,
  type IntervalTimelineEvent,
  type StateTimelineEvent,
  type TimelineEvent,
} from "../mod.ts";

type NamedEvent = TimelineEvent & {
  readonly name: string;
};

type NamedIntervalEvent = IntervalTimelineEvent & {
  readonly name: string;
};

type TransportStateEvent = StateTimelineEvent & {
  readonly offset: number;
};

describe("Timeline", () => {
  it("stores events in time order and queries neighbors", () => {
    const timeline = new Timeline<NamedEvent>();
    const first = { name: "first", time: 1 };
    const second = { name: "second", time: 2 };
    const third = { name: "third", time: 2 };

    timeline.add(second).add(first).add(third);

    expect(timeline.length).toBe(3);
    expect(timeline.events.map((event) => event.name)).toEqual(["first", "second", "third"]);
    expect(timeline.get(1.5)).toBe(first);
    expect(timeline.get(2)).toBe(third);
    expect(timeline.getAfter(1)).toBe(second);
    expect(timeline.getBefore(2)).toBe(first);
    expect(timeline.previousEvent(third)).toBe(second);
    expect(timeline.peek()).toBe(first);
    expect(timeline.shift()).toBe(first);
    expect(timeline.events.map((event) => event.name)).toEqual(["second", "third"]);
  });

  it("iterates and cancels bounded event ranges", () => {
    const timeline = new Timeline<NamedEvent>();
    timeline
      .add({ name: "zero", time: 0 })
      .add({ name: "one", time: 1 })
      .add({ name: "two", time: 2 })
      .add({ name: "three", time: 3 });

    const between: string[] = [];
    timeline.forEachBetween(1, 3, (event) => between.push(event.name));
    expect(between).toEqual(["one", "two"]);

    const from: string[] = [];
    timeline.forEachFrom(2, (event) => from.push(event.name));
    expect(from).toEqual(["two", "three"]);

    timeline.cancel(2);
    expect(timeline.events.map((event) => event.name)).toEqual(["zero", "one"]);

    timeline.cancelBefore(0);
    expect(timeline.events.map((event) => event.name)).toEqual(["one"]);
  });

  it("supports increasing timelines and bounded memory", () => {
    const timeline = new Timeline<NamedEvent>({ increasing: true, memory: 2 });

    timeline.add({ name: "one", time: 1 }).add({ name: "two", time: 2 });
    timeline.add({ name: "three", time: 3 });

    expect(timeline.events.map((event) => event.name)).toEqual(["two", "three"]);
    expect(() => timeline.add({ name: "old", time: 2.5 })).toThrow(RangeError);
    expect(() => new Timeline({ memory: 1.5 })).toThrow(RangeError);
    expect(() => timeline.add({ name: "bad", time: Number.NaN })).toThrow(RangeError);
  });

  it("removes and clears events without exposing mutable storage", () => {
    const timeline = new Timeline<NamedEvent>();
    const event = { name: "event", time: 1 };

    timeline.add(event);
    timeline.remove(event);
    expect(timeline.length).toBe(0);

    timeline.add(event).dispose();
    expect(timeline.length).toBe(0);
  });
});

describe("TimelineValue", () => {
  it("returns the latest value at or before a time", () => {
    const value = new TimelineValue("idle");

    value.set("attack", 1).set("release", 2);

    expect(value).toBeInstanceOf(TimelineValue);
    expect(value.get(0.5)).toBe("idle");
    expect(value.get(1.5)).toBe("attack");
    expect(value.get(2)).toBe("release");
    expect(value.length).toBe(2);
  });
});

describe("StateTimeline", () => {
  it("tracks playback state changes with typed metadata", () => {
    const state = new StateTimeline<TransportStateEvent>();

    state.setStateAtTime("started", 1, { offset: 0 });
    state.setStateAtTime("paused", 2, { offset: 1 });
    state.setStateAtTime("started", 3, { offset: 1 });

    expect(state).toBeInstanceOf(StateTimeline);
    expect(state.getValueAtTime(0.5)).toBe("stopped");
    expect(state.getValueAtTime(2.5)).toBe("paused");
    expect(state.getLastState("started", 2.5)?.offset).toBe(0);
    expect(state.getNextState("started", 2.5)?.offset).toBe(1);
    expect(() => state.setStateAtTime("stopped", -1, { offset: 0 })).toThrow(RangeError);

    expectTypeOf(state.getValueAtTime(1)).toEqualTypeOf<PlaybackState>();
  });
});

describe("IntervalTimeline", () => {
  it("queries overlapping intervals by latest start time", () => {
    const timeline = new IntervalTimeline<NamedIntervalEvent>();
    const long = { duration: 10, name: "long", time: 0 };
    const short = { duration: 2, name: "short", time: 3 };

    timeline.add(long).add(short);

    expect(timeline).toBeInstanceOf(IntervalTimeline);
    expect(timeline.get(1)).toBe(long);
    expect(timeline.get(3.5)).toBe(short);
    expect(timeline.get(5)).toBe(long);
    expect(timeline.get(10)).toBeUndefined();

    const active: string[] = [];
    timeline.forEachAtTime(3.5, (event) => active.push(event.name));
    expect(active).toEqual(["long", "short"]);
  });

  it("removes, cancels, and validates interval events", () => {
    const timeline = new IntervalTimeline<NamedIntervalEvent>();
    const first = { duration: 1, name: "first", time: 1 };
    const second = { duration: 1, name: "second", time: 2 };

    timeline.add(second).add(first);
    expect(timeline.events.map((event) => event.name)).toEqual(["first", "second"]);

    timeline.remove(first);
    expect(timeline.events.map((event) => event.name)).toEqual(["second"]);

    timeline.cancel(2);
    expect(timeline.length).toBe(0);
    expect(() => timeline.add({ duration: -1, name: "bad", time: 1 })).toThrow(RangeError);
  });
});
