import { readdirSync, readFileSync } from "node:fs";

export function readWorkflowPackageJson(): {
  readonly dependencies: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly exports: Record<string, unknown>;
  readonly optionalDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
} {
  const value: unknown = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  );
  if (
    typeof value !== "object" ||
    value === null ||
    !("dependencies" in value) ||
    typeof value.dependencies !== "object" ||
    value.dependencies === null ||
    !("exports" in value) ||
    typeof value.exports !== "object" ||
    value.exports === null
  ) {
    throw new Error("Expected workflow package metadata");
  }
  const packageJson = value as {
    readonly dependencies: Record<string, string>;
    readonly devDependencies?: Record<string, string>;
    readonly exports: Record<string, unknown>;
    readonly optionalDependencies?: Record<string, string>;
    readonly peerDependencies?: Record<string, string>;
  };
  return {
    dependencies: packageJson.dependencies,
    ...(packageJson.devDependencies === undefined
      ? {}
      : { devDependencies: packageJson.devDependencies }),
    exports: packageJson.exports,
    ...(packageJson.optionalDependencies === undefined
      ? {}
      : { optionalDependencies: packageJson.optionalDependencies }),
    ...(packageJson.peerDependencies === undefined
      ? {}
      : { peerDependencies: packageJson.peerDependencies }),
  };
}

export function storageBackendPackageDependencies(packageJson: {
  readonly dependencies: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
}): readonly string[] {
  return [
    ...Object.keys(packageJson.dependencies),
    ...Object.keys(packageJson.devDependencies ?? {}),
    ...Object.keys(packageJson.optionalDependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
  ].filter(
    (specifier) => isStorageBackendSpecifier(specifier) || isConcreteBackendSpecifier(specifier),
  );
}

export function workflowRuntimeSourceFiles(): readonly URL[] {
  const sourceDirectory = new URL("../../src/", import.meta.url);
  return readdirSync(sourceDirectory)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
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

export function importSpecifiers(source: string, pattern: RegExp): readonly string[] {
  return [...source.matchAll(pattern)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

export function isStorageBackendSpecifier(specifier: string): boolean {
  return specifier.startsWith("@temelj/storage/") || specifier.startsWith("@temelj/storage-");
}

export function isConcreteBackendSpecifier(specifier: string): boolean {
  return ["@libsql/client", "better-sqlite3", "libsql", "mysql2", "pg", "sqlite"].includes(
    specifier,
  );
}
