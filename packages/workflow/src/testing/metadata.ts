import { readdirSync } from "node:fs";

export function workflowRuntimeSourceFiles(): readonly URL[] {
  const sourceDirectory = new URL("../../src/", import.meta.url);

  return readdirSync(sourceDirectory, { recursive: true, encoding: "utf8" })
    .filter(
      (file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.startsWith("testing/"),
    )
    .map((file) => new URL(file, sourceDirectory));
}

export function storageBackendImports(source: string): readonly string[] {
  return [
    ...importSpecifiers(source, /\bfrom\s+["']([^"']+)["']/g),
    ...importSpecifiers(source, /\bimport\s+["']([^"']+)["']/g),
    ...importSpecifiers(source, /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
  ].filter(
    (specifier) => isStorageBackendSpecifier(specifier) || isConcreteBackendSpecifier(specifier),
  );
}

function importSpecifiers(source: string, pattern: RegExp): readonly string[] {
  return [...source.matchAll(pattern)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

function isStorageBackendSpecifier(specifier: string): boolean {
  return specifier.startsWith("@temelj/storage/") || specifier.startsWith("@temelj/storage-");
}

function isConcreteBackendSpecifier(specifier: string): boolean {
  return ["@libsql/client", "better-sqlite3", "libsql", "mysql2", "pg", "sqlite"].includes(
    specifier,
  );
}
