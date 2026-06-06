// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import "../test/setup.ts";
import { useList } from "./use-list.ts";
import { useMap } from "./use-map.ts";
import { useQueue } from "./use-queue.ts";
import { useSet } from "./use-set.ts";

describe("collection hooks", () => {
  it("useList manages array mutations", () => {
    const { result } = renderHook(() => useList([1, 3]));

    act(() => result.current[1].insertAt(1, 2));
    expect(result.current[0]).toEqual([1, 2, 3]);

    act(() => result.current[1].updateAt(2, 4));
    expect(result.current[0]).toEqual([1, 2, 4]);

    act(() => result.current[1].removeAt(0));
    expect(result.current[0]).toEqual([2, 4]);

    act(() => result.current[1].clear());
    expect(result.current[0]).toEqual([]);
  });

  it("useQueue exposes FIFO helpers", () => {
    const { result } = renderHook(() => useQueue(["a"]));

    act(() => result.current.add("b"));
    expect(result.current.queue).toEqual(["a", "b"]);
    expect(result.current.first).toBe("a");
    expect(result.current.last).toBe("b");

    let removed: string | undefined;
    act(() => {
      removed = result.current.remove();
    });
    expect(removed).toBe("a");
    expect(result.current.queue).toEqual(["b"]);

    act(() => result.current.clear());
    expect(result.current.size).toBe(0);
  });

  it("useMap rerenders when the returned Map mutates", () => {
    const { result } = renderHook(() => useMap<string, number>([["a", 1]]));

    act(() => {
      result.current.set("b", 2);
    });
    expect(Array.from(result.current.entries())).toEqual([
      ["a", 1],
      ["b", 2],
    ]);

    act(() => {
      result.current.delete("a");
    });
    expect(result.current.has("a")).toBe(false);
  });

  it("useSet rerenders when the returned Set mutates", () => {
    const { result } = renderHook(() => useSet(["a"]));

    act(() => {
      result.current.add("b");
    });
    expect(Array.from(result.current.values())).toEqual(["a", "b"]);

    act(() => {
      result.current.delete("a");
    });
    expect(result.current.has("a")).toBe(false);

    act(() => {
      result.current.clear();
    });
    expect(result.current.size).toBe(0);
  });
});
