// @vitest-environment jsdom
/* oxlint-disable vitest/require-mock-type-parameters */
import { err, isErr, isOk, ok } from "@temelj/result";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "../test/setup.ts";
import { useAsyncResultEffect } from "./use-async-result-effect.ts";
import { useBoolean } from "./use-boolean.ts";
import { useControllableState } from "./use-controllable-state.ts";
import { useCounter } from "./use-counter.ts";
import { useDefault } from "./use-default.ts";
import { useDisclosure } from "./use-disclosure.ts";
import { useEnumState } from "./use-enum-state.ts";
import { useHistoryState } from "./use-history-state.ts";
import { useIsFirstRender } from "./use-is-first-render.ts";
import { useLatestRef } from "./use-latest-ref.ts";
import { useMounted } from "./use-mounted.ts";
import { useObjectState } from "./use-object-state.ts";
import { usePreviousDistinct } from "./use-previous-distinct.ts";
import { usePrevious } from "./use-previous.ts";
import { useRenderCount } from "./use-render-count.ts";
import { useRenderInfo } from "./use-render-info.ts";
import { useResultEffect } from "./use-result-effect.ts";
import { useResultMemo } from "./use-result-memo.ts";
import { useResultReducer } from "./use-result-reducer.ts";
import { useResultState } from "./use-result-state.ts";
import { useStableCallback } from "./use-stable-callback.ts";
import { useToggle } from "./use-toggle.ts";
import { useUndoRedo } from "./use-undo-redo.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("state hooks", () => {
  it("useCounter manages bounded increments, decrements, set, and reset", () => {
    const { result } = renderHook(() => useCounter(1, { min: 0, max: 3, step: 2 }));

    act(() => result.current[1].increment());
    expect(result.current[0]).toBe(3);

    act(() => result.current[1].increment());
    expect(result.current[0]).toBe(3);

    act(() => result.current[1].decrement());
    expect(result.current[0]).toBe(1);

    act(() => result.current[1].set(-10));
    expect(result.current[0]).toBe(0);

    act(() => result.current[1].reset());
    expect(result.current[0]).toBe(1);
  });

  it("useBoolean and useDisclosure expose ergonomic boolean controls", () => {
    const booleanHook = renderHook(() => useBoolean());
    act(() => booleanHook.result.current[1].setTrue());
    expect(booleanHook.result.current[0]).toBe(true);
    act(() => booleanHook.result.current[1].toggle());
    expect(booleanHook.result.current[0]).toBe(false);

    const disclosureHook = renderHook(() => useDisclosure());
    act(() => disclosureHook.result.current[1].open());
    expect(disclosureHook.result.current[0]).toBe(true);
    act(() => disclosureHook.result.current[1].close());
    expect(disclosureHook.result.current[0]).toBe(false);
  });

  it("useToggle toggles or forces a boolean value", () => {
    const { result } = renderHook(() => useToggle(false));
    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
  });

  it("useDefault returns a fallback for nullish state only", () => {
    const { result } = renderHook(() => useDefault<string>(null, "fallback"));
    expect(result.current[0]).toBe("fallback");

    act(() => result.current[1]("value"));
    expect(result.current[0]).toBe("value");
  });

  it("useEnumState constrains values and supports cycling", () => {
    const { result } = renderHook(() => useEnumState(["one", "two", "three"] as const, "two"));
    act(() => result.current[1].next());
    expect(result.current[0]).toBe("three");
    act(() => result.current[1].next());
    expect(result.current[0]).toBe("one");
    act(() => result.current[1].previous());
    expect(result.current[0]).toBe("three");
    act(() => result.current[1].reset());
    expect(result.current[0]).toBe("two");
  });

  it("useControllableState supports uncontrolled and controlled usage", () => {
    const onChange = vi.fn();
    const uncontrolled = renderHook(() => useControllableState({ defaultValue: 1, onChange }));

    act(() => uncontrolled.result.current[1](2));
    expect(uncontrolled.result.current[0]).toBe(2);
    expect(onChange).toHaveBeenCalledWith(2);

    const controlled = renderHook(
      ({ value }) => useControllableState({ value, defaultValue: 0, onChange }),
      { initialProps: { value: 5 } },
    );
    act(() => controlled.result.current[1](6));
    expect(controlled.result.current[0]).toBe(5);
    expect(onChange).toHaveBeenCalledWith(6);
  });

  it("useObjectState shallow merges patch updates", () => {
    const { result } = renderHook(() => useObjectState({ a: 1, b: 2 }));
    act(() => result.current[1]({ b: 3 }));
    expect(result.current[0]).toEqual({ a: 1, b: 3 });
    act(() => result.current[1]((state) => ({ a: state.a + 1 })));
    expect(result.current[0]).toEqual({ a: 2, b: 3 });
  });

  it("useHistoryState and useUndoRedo move through history", () => {
    const history = renderHook(() => useHistoryState("a"));
    act(() => history.result.current.set("b"));
    act(() => history.result.current.set("c"));
    act(() => history.result.current.undo());
    expect(history.result.current.state).toBe("b");
    act(() => history.result.current.redo());
    expect(history.result.current.state).toBe("c");

    const undoRedo = renderHook(() => useUndoRedo(0, { maxHistory: 1 }));
    act(() => undoRedo.result.current.set(1));
    act(() => undoRedo.result.current.set(2));
    expect(undoRedo.result.current.past).toEqual([1]);
    act(() => undoRedo.result.current.undo());
    expect(undoRedo.result.current.value).toBe(1);
  });

  it("usePrevious and usePreviousDistinct report prior values", () => {
    const previous = renderHook(({ value }) => usePrevious(value), { initialProps: { value: 1 } });
    expect(previous.result.current).toBeUndefined();
    previous.rerender({ value: 2 });
    expect(previous.result.current).toBe(1);

    const distinct = renderHook(({ value }) => usePreviousDistinct(value), {
      initialProps: { value: 1 },
    });
    distinct.rerender({ value: 1 });
    expect(distinct.result.current).toBeUndefined();
    distinct.rerender({ value: 2 });
    expect(distinct.result.current).toBe(1);
  });

  it("useLatestRef and useStableCallback keep stable references with latest values", () => {
    const latest = renderHook(({ value }) => useLatestRef(value), { initialProps: { value: "a" } });
    const ref = latest.result.current;
    latest.rerender({ value: "b" });
    expect(latest.result.current).toBe(ref);
    expect(latest.result.current.current).toBe("b");

    const callback = renderHook(({ value }) => useStableCallback(() => value), {
      initialProps: { value: "a" },
    });
    const stable = callback.result.current;
    callback.rerender({ value: "b" });
    expect(callback.result.current).toBe(stable);
    expect(callback.result.current()).toBe("b");
  });

  it("useIsFirstRender, useRenderCount, useMounted, and useRenderInfo expose render diagnostics", () => {
    const first = renderHook(() => useIsFirstRender());
    expect(first.result.current).toBe(true);
    first.rerender();
    expect(first.result.current).toBe(false);

    const count = renderHook(() => useRenderCount());
    expect(count.result.current).toBe(1);
    count.rerender();
    expect(count.result.current).toBe(2);

    const mounted = renderHook(() => useMounted());
    expect(mounted.result.current()).toBe(true);
    mounted.unmount();
    expect(mounted.result.current()).toBe(false);

    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const info = renderHook(() => useRenderInfo("StateTest"));
    expect(info.result.current?.name).toBe("StateTest");
    expect(log).toHaveBeenCalled();
  });

  it("useRenderInfo returns undefined in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const { result } = renderHook(() => useRenderInfo("Prod"));
    expect(result.current).toBeUndefined();
  });

  it("useResultState maps and resets Result state", () => {
    const { result } = renderHook(() => useResultState<number, string>());
    act(() => result.current[1].setOk(2));
    expect(result.current[0]).toEqual(ok(2));
    act(() => result.current[1].map((value) => value + 1));
    expect(result.current[0]).toEqual(ok(3));
    act(() => result.current[1].setErr("bad"));
    act(() => result.current[1].mapErr((error) => `${error}!`));
    expect(result.current[0]).toEqual(err("bad!"));
    act(() => result.current[1].reset());
    expect(result.current[0]).toBeNull();
  });

  it("useResultMemo catches thrown memo computations", () => {
    const okMemo = renderHook(() => useResultMemo(() => 42, []));
    expect(okMemo.result.current).toEqual(ok(42));

    const errMemo = renderHook(() =>
      useResultMemo(
        () => {
          throw new Error("nope");
        },
        [],
        (error) => (error as Error).message,
      ),
    );
    expect(errMemo.result.current).toEqual(err("nope"));
  });

  it("useResultEffect and useAsyncResultEffect expose effect failures as Results", async () => {
    const sync = renderHook(() =>
      useResultEffect(
        () => {
          throw new Error("sync");
        },
        [],
        (error) => (error as Error).message,
      ),
    );
    await waitFor(() => expect(sync.result.current).toEqual(err("sync")));

    const asyncHook = renderHook(() => useAsyncResultEffect(async () => "done", []));
    await waitFor(() => {
      expect(asyncHook.result.current.status).toBe("success");
      expect(asyncHook.result.current.result).toEqual(ok("done"));
    });
  });

  it("useResultReducer only commits ok reducer results", () => {
    const { result } = renderHook(() =>
      useResultReducer<number, number, string>(
        (state, action) => (action < 0 ? err("negative") : ok(state + action)),
        1,
      ),
    );

    act(() => result.current[1](2));
    expect(result.current[0]).toBe(3);
    expect(isOk(result.current[2]!)).toBe(true);

    act(() => result.current[1](-1));
    expect(result.current[0]).toBe(3);
    expect(isErr(result.current[2]!)).toBe(true);
  });
});
