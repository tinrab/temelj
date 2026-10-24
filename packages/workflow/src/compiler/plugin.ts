import type { PluginContext as RolldownPluginContext } from "rolldown";
import type { PluginContext as RollupPluginContext } from "rollup";

import fs from "node:fs/promises";
import path from "node:path";
import { createUnplugin, type UnpluginFactory, type UnpluginInstance } from "unplugin";

import type {
  TransformManifest,
  TransformResult,
  TransformOptions,
  PluginOptions,
} from "../types/compiler.ts";

import { parseSource } from "./ast.ts";
import { stripQuery } from "./source.ts";
import { hasDirectiveCandidate, transformWorkflowSource } from "./transform.ts";

export type { PluginOptions } from "../types/compiler.ts";

const workflowUnpluginFactory: UnpluginFactory<PluginOptions | undefined> = (options = {}) => {
  const include = options.include?.map((pattern) => new RegExp(pattern));
  const exclude = options.exclude?.map((pattern) => new RegExp(pattern));
  const manifests = new Map<string, TransformManifest>();
  const manifestFileById = new Map<string, string>();
  const loadingManifests = new Set<string>();

  return {
    name: "temelj-workflow",
    enforce: "pre",
    transformInclude(id) {
      return matchesFilters(id, include, exclude);
    },
    transform(code, id) {
      return transformWithImports(undefined, code, id);
    },
    rollup: { transform: transformWithNativeContext },
    rolldown: { transform: transformWithNativeContext },
    unloader: { transform: transformWithNativeContext },
    vite: {
      transform: transformWithNativeContext,
      handleHotUpdate(context) {
        if (!matchesFilters(context.file, include, exclude)) {
          return;
        }

        const modules = context.modules.filter((module) => module.id !== null);

        if (modules.length === 0) {
          return;
        }

        return modules;
      },
    },
  };

  async function transformWithImports(
    context: ImportContext | undefined,
    code: string,
    id: string,
  ): Promise<TransformResult | null> {
    if (!matchesFilters(id, include, exclude)) {
      return null;
    }

    await loadImportManifests({
      context,
      code,
      id,
      options,
      include,
      exclude,
      manifests,
      manifestFileById,
      loadingManifests,
    });

    const result = transformAndStoreManifest(code, id, options, manifests, manifestFileById);

    return result ?? null;
  }

  function transformWithNativeContext(
    this: ImportContext,
    code: string,
    id: string,
  ): Promise<TransformResult | null> {
    return transformWithImports(this, code, id);
  }
};

const JS_TS_EXTENSION_PATTERN = /\.[cm]?[jt]sx?$/;

export const workflowPlugin: UnpluginInstance<PluginOptions | undefined, false> = createUnplugin<
  PluginOptions | undefined,
  false
>(workflowUnpluginFactory);

/** Creates the Vite plugin that compiles workflow and step directives. */
export const workflow: (options?: PluginOptions) => ReturnType<typeof workflowPlugin.vite> =
  workflowPlugin.vite;

interface LoadImportManifestsOptions {
  readonly context: ImportContext | undefined;
  readonly code: string;
  readonly id: string;
  readonly options: TransformOptions;
  readonly include: readonly RegExp[] | undefined;
  readonly exclude: readonly RegExp[] | undefined;
  readonly manifests: Map<string, TransformManifest>;
  readonly manifestFileById: Map<string, string>;
  readonly loadingManifests: Set<string>;
}

async function loadImportManifests({
  context,
  code,
  id,
  options,
  include,
  exclude,
  manifests,
  manifestFileById,
  loadingManifests,
}: LoadImportManifestsOptions): Promise<void> {
  if (!hasDirectiveCandidate(code) || loadingManifests.has(id)) {
    return;
  }

  loadingManifests.add(id);

  try {
    for (const source of collectRelativeImportSources(code, id)) {
      if (context !== undefined) {
        const resolved = await context.resolve(source, id, { skipSelf: true });

        if (resolved === null || !matchesFilters(resolved.id, include, exclude)) {
          continue;
        }

        await context.load({ id: resolved.id });
        await preloadImportFile({
          context,
          id: resolved.id,
          options,
          include,
          exclude,
          manifests,
          manifestFileById,
          loadingManifests,
        });
      } else {
        const resolved = await resolveRelativeImportFile(source, id);

        if (resolved === undefined || !matchesFilters(resolved, include, exclude)) {
          continue;
        }

        await preloadImportFile({
          context,
          id: resolved,
          options,
          include,
          exclude,
          manifests,
          manifestFileById,
          loadingManifests,
        });
      }
    }
  } finally {
    loadingManifests.delete(id);
  }
}

async function preloadImportFile({
  context,
  id,
  options,
  include,
  exclude,
  manifests,
  manifestFileById,
  loadingManifests,
}: Omit<LoadImportManifestsOptions, "code">): Promise<void> {
  const cleanId = stripQuery(id);
  const importedCode = await fs.readFile(cleanId, "utf8").catch(() => undefined);

  if (importedCode === undefined) {
    return;
  }

  await loadImportManifests({
    context,
    code: importedCode,
    id: cleanId,
    options,
    include,
    exclude,
    manifests,
    manifestFileById,
    loadingManifests,
  });
  transformAndStoreManifest(importedCode, cleanId, options, manifests, manifestFileById);
}

function transformAndStoreManifest(
  code: string,
  id: string,
  options: TransformOptions,
  manifests: Map<string, TransformManifest>,
  manifestFileById: Map<string, string>,
) {
  const result = transformWorkflowSource(code, id, {
    ...options,
    manifests: [...(options.manifests ?? []), ...manifests.values()],
  });

  if (result === undefined) {
    manifests.delete(id);
    const previousFile = manifestFileById.get(id);

    if (previousFile !== undefined) {
      manifests.delete(previousFile);
      manifestFileById.delete(id);
    }

    return undefined;
  }

  manifests.set(id, result.manifest);
  manifests.set(result.manifest.file, result.manifest);
  manifestFileById.set(id, result.manifest.file);

  return result;
}

type ImportContext =
  | Pick<RollupPluginContext, "resolve" | "load">
  | Pick<RolldownPluginContext, "resolve" | "load">;

function collectRelativeImportSources(code: string, id: string): readonly string[] {
  if (!JS_TS_EXTENSION_PATTERN.test(stripQuery(id))) {
    return [];
  }

  const sourceFile = parseSource(id, code);
  const sources = new Set<string>();

  for (const statement of sourceFile.program.body) {
    if (
      (statement.type === "ImportDeclaration" ||
        statement.type === "ExportNamedDeclaration" ||
        statement.type === "ExportAllDeclaration") &&
      statement.source !== null &&
      isRelativeImportSource(statement.source.value)
    ) {
      sources.add(statement.source.value);
    }
  }

  return [...sources];
}

function isRelativeImportSource(source: string): boolean {
  return source.startsWith("./") || source.startsWith("../");
}

const RELATIVE_IMPORT_EXTENSIONS = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  "/index.ts",
  "/index.tsx",
  "/index.mts",
  "/index.cts",
  "/index.js",
  "/index.jsx",
  "/index.mjs",
  "/index.cjs",
] as const;

async function resolveRelativeImportFile(
  source: string,
  importer: string,
): Promise<string | undefined> {
  const cleanImporter = stripQuery(importer);
  const base = path.resolve(path.dirname(cleanImporter), source);

  for (const candidate of relativeImportCandidates(base)) {
    const stat = await fs.stat(candidate).catch(() => undefined);

    if (stat?.isFile() === true) {
      return candidate;
    }
  }

  return undefined;
}

function relativeImportCandidates(base: string): readonly string[] {
  const candidates = RELATIVE_IMPORT_EXTENSIONS.map((extension) => `${base}${extension}`);
  const extension = path.extname(base);
  const mappedExtensions = ESM_SOURCE_EXTENSION_BY_IMPORT_EXTENSION.get(extension);

  if (mappedExtensions === undefined) {
    return candidates;
  }

  const withoutExtension = base.slice(0, -extension.length);

  return [
    base,
    ...mappedExtensions.map((mappedExtension) => `${withoutExtension}${mappedExtension}`),
    ...candidates.slice(1),
  ];
}

const ESM_SOURCE_EXTENSION_BY_IMPORT_EXTENSION = new Map<string, readonly string[]>([
  [".js", [".ts", ".tsx"]],
  [".jsx", [".tsx"]],
  [".mjs", [".mts"]],
  [".cjs", [".cts"]],
]);

function matchesFilters(
  id: string,
  include: readonly RegExp[] | undefined,
  exclude: readonly RegExp[] | undefined,
): boolean {
  if (exclude?.some((pattern) => pattern.test(id)) === true) {
    return false;
  }

  if (include !== undefined && !include.some((pattern) => pattern.test(id))) {
    return false;
  }

  return true;
}
