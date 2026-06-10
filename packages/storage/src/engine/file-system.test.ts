import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createStorage } from "../storage.ts";
import { FileSystemStorageEngine } from "./file-system.ts";

const directories: string[] = [];

describe("file system engine", () => {
  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
    );
  });

  test("stores bytes, scans prefixes, and clears values", async () => {
    const directory = await temporaryDirectory();
    const storage = createStorage({
      engine: new FileSystemStorageEngine({
        directory,
        prefix: "app",
      }),
    });

    await storage.set("users:1", { name: "Verso" });
    await storage.set("users:2", { name: "Maelle" });
    await storage.set("sessions:1", "active");

    expect(await storage.get("users:1")).toEqual({ name: "Verso" });
    expect(await storage.getMany(["users:1", "missing", "sessions:1"])).toEqual([
      { name: "Verso" },
      undefined,
      "active",
    ]);
    expect(await storage.keys({ prefix: "users:" })).toEqual(["users:1", "users:2"]);

    await storage.clear({ prefix: "users:" });

    expect(await storage.keys()).toEqual(["sessions:1"]);
  });

  test("treats path-like keys as literal storage keys", async () => {
    const directory = await temporaryDirectory();
    const storage = createStorage({
      engine: new FileSystemStorageEngine({ directory }),
    });

    await storage.set("../outside", "blocked");
    await storage.set("folders/items:1", "nested");

    expect(await storage.keys()).toEqual(["../outside", "folders/items:1"]);
    expect(await storage.get("../outside")).toBe("blocked");
    expect(await readdir(directory)).not.toContain("outside");
  });

  test("supports custom value and metadata extensions", async () => {
    const directory = await temporaryDirectory();
    const storage = createStorage({
      engine: new FileSystemStorageEngine({
        directory,
        metadataExtension: ".ttl",
        valueExtension: ".bytes",
      }),
    });

    await storage.set("sessions:1", "active", { ttl: 1_000 });

    const files = await readdir(directory);
    expect(files).toHaveLength(2);
    expect(files.some((file) => file.endsWith(".bytes"))).toBe(true);
    expect(files.some((file) => file.endsWith(".ttl"))).toBe(true);
    expect(files.some((file) => file.endsWith(".bin"))).toBe(false);
    expect(files.some((file) => file.endsWith(".meta.json"))).toBe(false);
    expect(await storage.keys()).toEqual(["sessions:1"]);
    expect(await storage.get("sessions:1")).toBe("active");
  });

  test("expires values and does not count expired deletes", async () => {
    vi.useFakeTimers();
    const directory = await temporaryDirectory();
    const storage = createStorage({
      engine: new FileSystemStorageEngine({ directory }),
    });

    await storage.set("sessions:1", "active", { ttl: 100 });
    expect(await storage.get("sessions:1")).toBe("active");

    await vi.advanceTimersByTimeAsync(100);

    expect(await storage.get("sessions:1")).toBeUndefined();
    expect(await storage.delete("sessions:1")).toBe(false);
  });

  test("supports setMany and deleteMany", async () => {
    const directory = await temporaryDirectory();
    const storage = createStorage({
      engine: new FileSystemStorageEngine({ directory }),
    });

    await storage.setMany([
      { key: "users:1", value: { name: "Verso" } },
      { key: "users:2", value: { name: "Maelle" } },
    ]);

    expect(await storage.deleteMany(["users:1", "missing", "users:2"])).toBe(2);
    expect(await storage.keys()).toEqual([]);
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "temelj-storage-"));
  directories.push(directory);
  return directory;
}
