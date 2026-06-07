import { describe, expect, test, vi } from "vitest";

import { createStorage } from "../storage.ts";
import { createLocalStorageEngine, type WebStorageLike } from "./local-storage.ts";

describe("localStorage engine", () => {
  test("stores bytes, scans prefixes, and expires values", async () => {
    vi.useFakeTimers();
    try {
      const storage = createStorage({
        engine: createLocalStorageEngine({
          namespace: "app",
          storage: createMockWebStorage(),
        }),
      });

      await storage.set("users:1", { name: "Verso" });
      await storage.set("users:2", { name: "Maelle" });
      await storage.set("sessions:1", "active", { ttl: 100 });

      expect(await storage.keys({ prefix: "users:" })).toEqual(["users:1", "users:2"]);
      await vi.advanceTimersByTimeAsync(100);
      expect(await storage.get("sessions:1")).toBeUndefined();
      await storage.clear({ prefix: "users:" });
      expect(await storage.keys()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

function createMockWebStorage(): WebStorageLike {
  const items = new Map<string, string>();
  return {
    get length(): number {
      return items.size;
    },
    clear: vi.fn<() => void>(() => {
      items.clear();
    }),
    getItem: vi.fn<(key: string) => string | null>(
      (key: string): string | null => items.get(key) ?? null,
    ),
    key: vi.fn<(index: number) => string | null>(
      (index: number): string | null => [...items.keys()][index] ?? null,
    ),
    removeItem: vi.fn<(key: string) => void>((key: string) => {
      items.delete(key);
    }),
    setItem: vi.fn<(key: string, value: string) => void>((key: string, value: string) => {
      items.set(key, value);
    }),
  };
}
