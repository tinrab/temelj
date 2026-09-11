import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const command = fileURLToPath(new URL("./scripts-expand-optional-fields.mjs", import.meta.url));

const collection = fileURLToPath(new URL("./src/collection.ts", import.meta.url));

await test("optional-field expansion preserves values, omission, and evaluation order", async () => {
  const directory = mkdtempSync(join(tmpdir(), "temelj-optional-fields-"));
  const beforePath = join(directory, "before.ts");
  const afterPath = join(directory, "after.ts");

  const source = `
import { optionalProperty } from ${JSON.stringify(collection)};
export function create(enabled: boolean, events: string[]): { value: number; optional?: number } {
  function read(label: string): number { events.push(label); return events.length; }
  return {
    value: read("base"),
    ...(enabled ? { optional: read("included") } : {}),
    ...(enabled === false ? {} : { value: read("overwrite") }),
  };
}
export function mixedCreate(enabled: boolean, events: string[]): { value: number; optional?: number; label: string } {
  function read(label: string): number { events.push(label); return events.length; }
  return {
    value: read("base"),
    ...(enabled ? { optional: read("optional") } : {}),
    label: String(read("required")),
    ...(enabled ? { value: read("overwrite") } : {}),
    value: read("last"),
  };
}
export function variableCreate(value?: number): { value?: number; label: string } {
  const result: { value?: number; label: string } = { ...(value === undefined ? {} : { value }), label: "mixed" };
  return result;
}
export async function asyncCreate(value?: number): Promise<{ value?: number }> {
  return { ...(value === undefined ? {} : { value }) };
}
export function nestedCreate(enabled: boolean, include: boolean, events: string[]): { item?: { value: number; optional?: number; nested?: number; tail?: number } } {
  function read(label: string): number { events.push(label); return events.length; }
  return enabled ? { item: {
    value: read("base"),
    ...(include ? { optional: read("outer"), ...(include ? { nested: read("inner") } : {}) } : {}),
    ...optionalProperty("tail", read("tail")),
  } } : {};
}
export function helperCreate(enabled: boolean, events: string[]): { value?: number; tail?: number } {
  function read(label: string): number { events.push(label); return events.length; }
  return { ...(enabled ? { ...optionalProperty("value", read("branch")) } : {}), ...optionalProperty("tail", read("tail")) };
}
`;

  try {
    writeFileSync(beforePath, source);
    writeFileSync(afterPath, source);

    const result = execFileSync(process.execPath, [command, "--write", afterPath], {
      encoding: "utf8",
    });

    assert.match(result, /Expanded 9 conditional spreads/);
    const before = await import(pathToFileURL(beforePath).href);
    const after = await import(pathToFileURL(afterPath).href);

    for (const enabled of [true, false]) {
      const beforeEvents = [];
      const afterEvents = [];
      const expected = before.create(enabled, beforeEvents);
      const actual = after.create(enabled, afterEvents);
      assert.deepEqual(actual, expected);
      assert.deepEqual(Object.keys(actual), Object.keys(expected));
      assert.deepEqual(afterEvents, beforeEvents);

      for (const include of [true, false]) {
        beforeEvents.length = 0;
        afterEvents.length = 0;
        const expectedNested = before.nestedCreate(enabled, include, beforeEvents);
        const actualNested = after.nestedCreate(enabled, include, afterEvents);
        assert.deepEqual(actualNested, expectedNested);
        assert.deepEqual(
          Object.keys(actualNested.item ?? {}),
          Object.keys(expectedNested.item ?? {}),
        );
        assert.deepEqual(afterEvents, beforeEvents);
      }

      beforeEvents.length = 0;
      afterEvents.length = 0;
      assert.deepEqual(
        after.helperCreate(enabled, afterEvents),
        before.helperCreate(enabled, beforeEvents),
      );
      assert.deepEqual(afterEvents, beforeEvents);

      beforeEvents.length = 0;
      afterEvents.length = 0;
      const expectedMixed = before.mixedCreate(enabled, beforeEvents);
      const actualMixed = after.mixedCreate(enabled, afterEvents);
      assert.deepEqual(actualMixed, expectedMixed);
      assert.deepEqual(Object.keys(actualMixed), Object.keys(expectedMixed));
      assert.deepEqual(afterEvents, beforeEvents);
    }

    for (const value of [undefined, 0, 42]) {
      assert.deepEqual(await after.asyncCreate(value), await before.asyncCreate(value));
      assert.deepEqual(after.variableCreate(value), before.variableCreate(value));
    }

    const migrated = readFileSync(afterPath, "utf8");
    execFileSync(process.execPath, [command, "--write", afterPath]);
    assert.equal(readFileSync(afterPath, "utf8"), migrated);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

await test("leaves accessors, prototype setters, and commented suffixes for manual review", () => {
  const directory = mkdtempSync(join(tmpdir(), "temelj-optional-fields-"));
  const path = join(directory, "source.ts");

  const source = `
import { optionalProperty } from ${JSON.stringify(collection)};
function accessor(flag: boolean): { value: number } { return { get value() { return 1; }, ...(flag ? { value: 2 } : {}) }; }
function prototype(flag: boolean): { value?: number } { return { __proto__: null, ...(flag ? { value: 2 } : {}) }; }
function spreadAfter(flag: boolean): { value?: number } { const other = {}; return { ...(flag ? { value: 2 } : {}), ...other }; }
function commented(flag: boolean): { value?: number } { return { ...(flag ? { value: 2 } : {}), /* reason */ }; }
function prototypeHelper(flag: boolean): object { return { ...(flag ? { ...optionalProperty("__proto__", {}) } : {}) }; }
function wrappedComment(flag: boolean): { item?: { value?: number } } { return flag ? /* reason */ { item: { ...(flag ? { value: 2 } : {}) } } : {}; }
`;

  try {
    writeFileSync(path, source);
    const result = execFileSync(process.execPath, [command, "--write", path], { encoding: "utf8" });
    assert.match(result, /Expanded 0 conditional spreads/);
    assert.equal(readFileSync(path, "utf8"), source);

    const shadowed = `import { optionalProperty } from ${JSON.stringify(collection)};
function shadowed(flag: boolean, optionalProperty: (key: string, value: number) => object): object { return { ...(flag ? { ...optionalProperty("value", 1) } : {}) }; }`;

    writeFileSync(path, shadowed);
    assert.match(
      execFileSync(process.execPath, [command, "--write", path], { encoding: "utf8" }),
      /Expanded 0 conditional spreads/,
    );
    assert.equal(readFileSync(path, "utf8"), shadowed);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
