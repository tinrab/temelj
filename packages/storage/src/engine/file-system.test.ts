import { hashCyrb53 } from "@temelj/string";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createStorage } from "../storage.ts";
import { createFileSystemEngine } from "./file-system.ts";

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
      engine: createFileSystemEngine({
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
      engine: createFileSystemEngine({ directory }),
    });

    await storage.set("../outside", "blocked");
    await storage.set("folders/items:1", "nested");

    expect(await storage.keys()).toEqual(["../outside", "folders/items:1"]);
    expect(await storage.get("../outside")).toBe("blocked");
    expect(await readdir(directory)).not.toContain("outside");
  });

  test("uses custom file and metadata extensions", async () => {
    const directory = await temporaryDirectory();
    const storage = createStorage({
      engine: createFileSystemEngine({
        directory,
        metadataExtension: ".expires.json",
        valueExtension: ".value",
      }),
    });

    await storage.set("sessions:1", "active", { ttl: 100 });

    const entries = await readdir(directory);
    expect(entries.some((entry) => entry.endsWith(".value"))).toBe(true);
    expect(entries.some((entry) => entry.endsWith(".expires.json"))).toBe(true);
    expect(entries.some((entry) => entry.endsWith(".bin"))).toBe(false);
    expect(entries.some((entry) => entry.endsWith(".meta.json"))).toBe(false);
    expect(await storage.get("sessions:1")).toBe("active");
  });

  test("expires values and does not count expired deletes", async () => {
    vi.useFakeTimers();
    const directory = await temporaryDirectory();
    const storage = createStorage({
      engine: createFileSystemEngine({ directory }),
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
      engine: createFileSystemEngine({ directory }),
    });

    await storage.setMany([
      { key: "users:1", value: { name: "Verso" } },
      { key: "users:2", value: { name: "Maelle" } },
    ]);

    expect(await storage.deleteMany(["users:1", "missing", "users:2"])).toBe(2);
    expect(await storage.keys()).toEqual([]);
  });

  test("stores records in fixed hash bucket files", async () => {
    const directory = await temporaryDirectory();
    const storage = createStorage({
      engine: createFileSystemEngine({
        bucketCount: 4,
        bucketFileNameFormat: "records-{bucket}.json",
        directory,
        prefix: "app",
        strategy: "bucket",
      }),
    });

    await storage.setMany([
      { key: "users:1", value: { name: "Verso" } },
      { key: "users:2", value: { name: "Maelle" } },
      { key: "sessions:1", value: "active" },
    ]);

    expect(await storage.get("users:1")).toEqual({ name: "Verso" });
    expect(await storage.keys({ prefix: "users:" })).toEqual(["users:1", "users:2"]);
    expect(await storage.getMany(["users:2", "missing", "sessions:1"])).toEqual([
      { name: "Maelle" },
      undefined,
      "active",
    ]);

    const entries = await readdir(directory);
    const expectedBucketNames = [
      bucketName("app:users:1", 4),
      bucketName("app:users:2", 4),
      bucketName("app:sessions:1", 4),
    ];
    expect(entries.filter((entry) => entry.endsWith(".json")).sort()).toEqual(
      [...new Set(expectedBucketNames)].sort(),
    );
    expect(entries.some((entry) => entry.endsWith(".bucket.json"))).toBe(false);
    expect(entries.some((entry) => entry.endsWith(".bin"))).toBe(false);

    const usersBucketName = bucketName("app:users:2", 4);
    const usersBucket = JSON.parse(await readFile(join(directory, usersBucketName), "utf8")) as {
      readonly records: Record<string, unknown>;
    };
    expect(usersBucket.records["app:users:2"]).toBeDefined();

    await storage.set("users:2", { name: "Margot" });
    expect(await storage.get("users:2")).toEqual({ name: "Margot" });
    const updatedUsersBucket = JSON.parse(
      await readFile(join(directory, usersBucketName), "utf8"),
    ) as {
      readonly records: Record<string, unknown>;
    };
    expect(updatedUsersBucket.records["app:users:2"]).toBeDefined();
  });

  test("expires bucket records and clears matching prefixes", async () => {
    vi.useFakeTimers();
    const directory = await temporaryDirectory();
    const storage = createStorage({
      engine: createFileSystemEngine({
        bucketCount: 4,
        directory,
        strategy: "bucket",
      }),
    });

    await storage.set("sessions:1", "active", { ttl: 100 });
    await storage.set("users:1", { name: "Verso" });
    await storage.set("users:2", { name: "Maelle" });

    expect((await readdir(directory)).every((entry) => /^bucket-\d+\.json$/.test(entry))).toBe(
      true,
    );

    await vi.advanceTimersByTimeAsync(100);

    expect(await storage.get("sessions:1")).toBeUndefined();
    expect(await storage.delete("sessions:1")).toBe(false);
    expect(await storage.keys()).toEqual(["users:1", "users:2"]);

    await storage.clear({ prefix: "users:" });

    expect(await storage.keys()).toEqual([]);
    expect(await readdir(directory)).toEqual([]);
  });

  test("rejects invalid bucket configuration", async () => {
    const directory = await temporaryDirectory();

    expect(() =>
      createFileSystemEngine({
        bucketCount: 0,
        directory,
        strategy: "bucket",
      }),
    ).toThrow(RangeError);
    expect(() =>
      createFileSystemEngine({
        bucketFileNameFormat: "bucket.json",
        directory,
        strategy: "bucket",
      }),
    ).toThrow(RangeError);
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "temelj-storage-"));
  directories.push(directory);
  return directory;
}

function bucketName(key: string, bucketCount: number): string {
  return `records-${hashCyrb53(key) % bucketCount}.json`;
}
