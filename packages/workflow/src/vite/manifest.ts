import type {
  ExportAllDeclaration,
  ExportNamedDeclaration,
  ImportDeclaration,
  ModuleExportName,
  Program,
} from "oxc-parser";

import path from "node:path";

import type {
  TransformManifest,
  TransformManifestFunction,
  TransformManifestImportEdge,
} from "../types/vite.ts";

import { WorkflowTransformError } from "./error.ts";

const JS_TS_EXTENSION_PATTERN = /\.[cm]?[jt]sx?$/;

export function collectImportedStepBindings(
  sourceFile: Program,
  file: string,
  manifests: readonly TransformManifest[],
): ReadonlyMap<string, TransformManifestImportEdge> {
  const manifestBySource = new Map(manifests.map((manifest) => [manifest.file, manifest]));
  const importedSteps = new Map<string, TransformManifestImportEdge>();
  for (const statement of sourceFile.body) {
    if (statement.type !== "ImportDeclaration" || statement.importKind === "type") {
      continue;
    }
    const resolved = resolveManifestImport(file, statement.source.value, manifestBySource);
    if (resolved === undefined) {
      continue;
    }
    if (hasNonNamedImportSpecifier(statement)) {
      WorkflowTransformError.directiveImportsMustBeNamed(statement.source.value);
    }
    const exportedSteps = new Map(
      resolved.manifest.functions
        .filter((entry) => entry.kind === "step")
        .map((entry) => [entry.exportName, entry]),
    );
    for (const element of statement.specifiers) {
      if (element.type !== "ImportSpecifier" || element.importKind === "type") {
        continue;
      }
      const importName = moduleExportNameText(element.imported);
      const step = exportedSteps.get(importName);
      if (step === undefined) {
        continue;
      }
      importedSteps.set(element.local.name, {
        source: resolved.source,
        importName,
        localName: element.local.name,
        kind: "step",
        workflowName: step.workflowName,
        ...(step.version === undefined ? {} : { version: step.version }),
      });
    }
  }
  return importedSteps;
}

export function collectReExportedManifestFunctions(
  sourceFile: Program,
  file: string,
  manifests: readonly TransformManifest[],
): readonly TransformManifestFunction[] {
  const manifestBySource = new Map(manifests.map((manifest) => [manifest.file, manifest]));
  const functions: TransformManifestFunction[] = [];
  for (const statement of sourceFile.body) {
    if (!isSupportedReExportDeclaration(statement) || statement.exportKind === "type") {
      continue;
    }
    if (statement.type === "ExportAllDeclaration" && statement.exported !== null) {
      WorkflowTransformError.directiveReExportsMustBeNamed(statement.source.value);
    }
    const resolved = resolveManifestImport(file, statement.source.value, manifestBySource);
    if (resolved === undefined) {
      continue;
    }
    if (statement.type === "ExportAllDeclaration") {
      functions.push(...resolved.manifest.functions);
      continue;
    }
    const exported = new Map(resolved.manifest.functions.map((entry) => [entry.exportName, entry]));
    for (const element of statement.specifiers) {
      if (element.exportKind === "type") {
        continue;
      }
      const importName = moduleExportNameText(element.local);
      const entry = exported.get(importName);
      if (entry === undefined) {
        continue;
      }
      functions.push({
        kind: entry.kind,
        exportName: moduleExportNameText(element.exported),
        localName: entry.localName,
        generatedName: entry.generatedName,
        workflowName: entry.workflowName,
        ...(entry.version === undefined ? {} : { version: entry.version }),
      });
    }
  }
  return functions;
}

function hasNonNamedImportSpecifier(statement: ImportDeclaration): boolean {
  return statement.specifiers.some((specifier) => specifier.type !== "ImportSpecifier");
}

function isSupportedReExportDeclaration(
  statement: Program["body"][number],
): statement is
  | ExportAllDeclaration
  | (ExportNamedDeclaration & { readonly source: NonNullable<ExportNamedDeclaration["source"]> }) {
  return (
    statement.type === "ExportAllDeclaration" ||
    (statement.type === "ExportNamedDeclaration" && statement.source !== null)
  );
}

function moduleExportNameText(name: ModuleExportName): string {
  return name.type === "Literal" ? String(name.value) : name.name;
}

function resolveManifestImport(
  file: string,
  specifier: string,
  manifestBySource: ReadonlyMap<string, TransformManifest>,
): { readonly source: string; readonly manifest: TransformManifest } | undefined {
  const source = resolveManifestImportSource(file, specifier);
  const manifest = manifestBySource.get(source);
  if (manifest !== undefined) {
    return { source, manifest };
  }
  for (const alias of sourceAliases(source)) {
    const aliasManifest = manifestBySource.get(alias);
    if (aliasManifest !== undefined) {
      return { source: alias, manifest: aliasManifest };
    }
  }
  return undefined;
}

function resolveManifestImportSource(file: string, specifier: string): string {
  if (!specifier.startsWith(".")) {
    return specifier;
  }
  const directory = path.posix.dirname(file);
  const resolved = path.posix.normalize(path.posix.join(directory, specifier));
  if (JS_TS_EXTENSION_PATTERN.test(resolved)) {
    return resolved;
  }
  return `${resolved}.ts`;
}

function sourceAliases(source: string): readonly string[] {
  const extension = path.posix.extname(source);
  const aliases = ESM_SOURCE_EXTENSION_BY_IMPORT_EXTENSION.get(extension);
  if (aliases === undefined) {
    return [];
  }
  const withoutExtension = source.slice(0, -extension.length);
  return aliases.map((alias) => `${withoutExtension}${alias}`);
}

const ESM_SOURCE_EXTENSION_BY_IMPORT_EXTENSION = new Map<string, readonly string[]>([
  [".js", [".ts", ".tsx"]],
  [".jsx", [".tsx"]],
  [".mjs", [".mts"]],
  [".cjs", [".cts"]],
]);
