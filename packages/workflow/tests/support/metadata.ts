import { readdirSync, readFileSync } from "node:fs";
import { z } from "zod";

const dependenciesSchema = z.record(z.string(), z.string());

const workflowPackageMetadataSchema = z.object({
  dependencies: dependenciesSchema,
  devDependencies: dependenciesSchema.optional(),
  exports: z.record(z.string(), z.object({ types: z.string(), import: z.string() })),
  optionalDependencies: dependenciesSchema.optional(),
  peerDependencies: dependenciesSchema.optional(),
});

type WorkflowPackageMetadata = z.infer<typeof workflowPackageMetadataSchema>;

export function readWorkflowPackageJson(): WorkflowPackageMetadata {
  return workflowPackageMetadataSchema.parse(
    JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")),
  );
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
