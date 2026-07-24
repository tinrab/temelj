import type { Configuration as RspackConfiguration, Stats as RspackStats } from "@rspack/core";
import type { Configuration as WebpackConfiguration, Stats as WebpackStats } from "webpack";

import rspack from "@rspack/core";
import { build as esbuild } from "esbuild";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { rolldown } from "rolldown";
import { rollup } from "rollup";
import { describe, expect, it } from "vitest";
import webpack from "webpack";

import { workflow as esbuildWorkflow } from "../../src/esbuild.ts";
import { workflow as rolldownWorkflow } from "../../src/rolldown.ts";
import { workflow as rollupWorkflow } from "../../src/rollup.ts";
import { workflow as rspackWorkflow } from "../../src/rspack.ts";
import { workflow as viteWorkflow } from "../../src/vite.ts";
import { workflow as webpackWorkflow } from "../../src/webpack.ts";

const CALL_WORKFLOW_STEP_FUNCTION_NAME = "callWorkflowStepFunction";
const CALL_WORKFLOW_STEP_INVOCATION_TEXT = "callWorkflowStepFunction(__temelj_context.step";

describe("workflow bundler plugins", () => {
  it("exposes callable workflow factories for every bundler subpath", () => {
    const factories = [
      esbuildWorkflow,
      rolldownWorkflow,
      rollupWorkflow,
      rspackWorkflow,
      viteWorkflow,
      webpackWorkflow,
    ];

    for (const factory of factories) {
      expect(factory).toEqual(expect.any(Function));
      expect(factory({ root: "/repo" })).toBeDefined();
    }
  });

  it("rewrites imported steps when built by Rollup", async () => {
    await withWorkflowFixture(async (fixture) => {
      const bundle = await rollup({
        input: fixture.entry,
        external: ["@temelj/workflow"],
        plugins: [rollupWorkflow({ root: fixture.root })],
      });
      const output = await bundle.generate({ format: "esm" });
      await bundle.close();

      expect(output.output[0]?.code).toContain(CALL_WORKFLOW_STEP_FUNCTION_NAME);
    });
  });

  it("rewrites imported steps when built by Rolldown", async () => {
    await withWorkflowFixture(async (fixture) => {
      const bundle = await rolldown({
        input: fixture.entry,
        external: ["@temelj/workflow"],
        plugins: [rolldownWorkflow({ root: fixture.root })],
      });
      const output = await bundle.generate({ format: "esm" });
      await bundle.close();

      expect(output.output[0]?.code).toContain(CALL_WORKFLOW_STEP_FUNCTION_NAME);
    });
  });

  it("rewrites imported steps when built by esbuild", async () => {
    await withWorkflowFixture(async (fixture) => {
      const result = await esbuild({
        entryPoints: [fixture.entry],
        bundle: true,
        write: false,
        format: "esm",
        platform: "node",
        external: ["@temelj/workflow"],
        plugins: [esbuildWorkflow({ root: fixture.root })],
      });

      expect(result.outputFiles[0]?.text).toContain(CALL_WORKFLOW_STEP_FUNCTION_NAME);
    });
  });

  it("rewrites TypeScript steps imported with .js specifiers when built by esbuild", async () => {
    await withTypeScriptEsmWorkflowFixture(async (fixture) => {
      const result = await esbuild({
        entryPoints: [fixture.entry],
        bundle: true,
        write: false,
        format: "esm",
        platform: "node",
        external: ["@temelj/workflow"],
        plugins: [esbuildWorkflow({ root: fixture.root })],
      });

      expect(result.outputFiles[0]?.text).toContain(CALL_WORKFLOW_STEP_FUNCTION_NAME);
    });
  });

  it("prefers exact .js imports over TypeScript siblings when built by esbuild", async () => {
    await withConflictingEsmWorkflowFixture(async (fixture) => {
      const result = await esbuild({
        entryPoints: [fixture.entry],
        bundle: true,
        write: false,
        format: "esm",
        platform: "node",
        external: ["@temelj/workflow"],
        plugins: [esbuildWorkflow({ root: fixture.root })],
      });

      expect(result.outputFiles[0]?.text).not.toContain(CALL_WORKFLOW_STEP_INVOCATION_TEXT);
    });
  });

  it("rewrites imported steps when built by webpack", async () => {
    await withWorkflowFixture(async (fixture) => {
      const output = await runWebpackLikeBuild({
        compiler: "webpack",
        entry: fixture.entry,
        root: fixture.root,
      });

      expect(output).toContain(CALL_WORKFLOW_STEP_FUNCTION_NAME);
    });
  });

  it("rewrites TypeScript steps imported with .js specifiers when built by webpack", async () => {
    await withTypeScriptEsmWorkflowFixture(async (fixture) => {
      const output = await runWebpackLikeBuild({
        compiler: "webpack",
        entry: fixture.entry,
        root: fixture.root,
        resolveTypeScriptEsm: true,
      });

      expect(output).toContain(CALL_WORKFLOW_STEP_FUNCTION_NAME);
    });
  });

  it("rewrites imported steps when built by Rspack", async () => {
    await withWorkflowFixture(async (fixture) => {
      const output = await runWebpackLikeBuild({
        compiler: "rspack",
        entry: fixture.entry,
        root: fixture.root,
      });

      expect(output).toContain(CALL_WORKFLOW_STEP_FUNCTION_NAME);
    });
  });

  it("rewrites TypeScript steps imported with .js specifiers when built by Rspack", async () => {
    await withTypeScriptEsmWorkflowFixture(async (fixture) => {
      const output = await runWebpackLikeBuild({
        compiler: "rspack",
        entry: fixture.entry,
        root: fixture.root,
        resolveTypeScriptEsm: true,
      });

      expect(output).toContain(CALL_WORKFLOW_STEP_FUNCTION_NAME);
    });
  });
});

interface WorkflowFixture {
  readonly root: string;
  readonly entry: string;
}

async function withWorkflowFixture(
  callback: (fixture: WorkflowFixture) => Promise<void>,
): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "temelj-workflow-bundler-"));
  try {
    await fs.writeFile(
      path.join(root, "steps.js"),
      `
export async function loadUser(userId) {
  "use step";
  return { name: userId };
}
`,
    );
    await fs.writeFile(
      path.join(root, "workflow.js"),
      `
import { loadUser } from "./steps.js";

export async function welcomeUser(userId) {
  "use workflow";
  const user = await loadUser(userId);
  return user.name;
}
`,
    );
    const entry = path.join(root, "entry.js");
    await fs.writeFile(entry, `export { welcomeUser } from "./workflow.js";\n`);
    await callback({ root, entry });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function withTypeScriptEsmWorkflowFixture(
  callback: (fixture: WorkflowFixture) => Promise<void>,
): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "temelj-workflow-bundler-"));
  try {
    await fs.writeFile(
      path.join(root, "steps.ts"),
      `
export async function loadUser(userId) {
  "use step";
  return { name: userId };
}
`,
    );
    await fs.writeFile(
      path.join(root, "workflow.ts"),
      `
import { loadUser } from "./steps.js";

export async function welcomeUser(userId) {
  "use workflow";
  const user = await loadUser(userId);
  return user.name;
}
`,
    );
    const entry = path.join(root, "entry.ts");
    await fs.writeFile(entry, `export { welcomeUser } from "./workflow.js";\n`);
    await callback({ root, entry });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function withConflictingEsmWorkflowFixture(
  callback: (fixture: WorkflowFixture) => Promise<void>,
): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "temelj-workflow-bundler-"));
  try {
    await fs.writeFile(
      path.join(root, "steps.js"),
      `
export async function loadUser(userId) {
  return { name: userId };
}
`,
    );
    await fs.writeFile(
      path.join(root, "steps.ts"),
      `
export async function loadUser(userId) {
  "use step";
  return { name: userId };
}
`,
    );
    await fs.writeFile(
      path.join(root, "workflow.js"),
      `
import { loadUser } from "./steps.js";

export async function welcomeUser(userId) {
  "use workflow";
  const user = await loadUser(userId);
  return user.name;
}
`,
    );
    const entry = path.join(root, "entry.js");
    await fs.writeFile(entry, `export { welcomeUser } from "./workflow.js";\n`);
    await callback({ root, entry });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

interface WebpackLikeBuildOptions {
  readonly compiler: "webpack" | "rspack";
  readonly root: string;
  readonly entry: string;
  readonly resolveTypeScriptEsm?: boolean;
}

async function runWebpackLikeBuild(options: WebpackLikeBuildOptions): Promise<string> {
  const outputPath = path.join(options.root, "dist");

  if (options.compiler === "webpack") {
    const config: WebpackConfiguration = {
      ...webpackLikeBaseConfig(options, outputPath),
      plugins: [webpackWorkflow({ root: options.root })],
    };
    await new Promise<void>((resolve, reject) => {
      webpack(config, (error, stats) => {
        handleWebpackLikeResult(error, stats, resolve, reject);
      });
    });
  } else {
    const config: RspackConfiguration = {
      ...webpackLikeBaseConfig(options, outputPath),
      plugins: [rspackWorkflow({ root: options.root })],
    };
    await new Promise<void>((resolve, reject) => {
      rspack(config, (error, stats) => {
        handleWebpackLikeResult(error, stats, resolve, reject);
      });
    });
  }

  return await fs.readFile(path.join(outputPath, "bundle.js"), "utf8");
}

function webpackLikeBaseConfig(
  options: WebpackLikeBuildOptions,
  outputPath: string,
): WebpackConfiguration & RspackConfiguration {
  return {
    mode: "development",
    target: "node",
    devtool: false,
    entry: options.entry,
    output: {
      path: outputPath,
      filename: "bundle.js",
      library: { type: "commonjs2" },
    },
    externals: {
      "@temelj/workflow": "commonjs @temelj/workflow",
    },
    resolve:
      options.resolveTypeScriptEsm === true
        ? {
            extensionAlias: {
              ".js": [".ts", ".js"],
              ".mjs": [".mts", ".mjs"],
              ".cjs": [".cts", ".cjs"],
            },
          }
        : {},
    optimization: {
      minimize: false,
    },
  };
}

function handleWebpackLikeResult(
  error: Error | null | undefined,
  stats: RspackStats | WebpackStats | undefined,
  resolve: () => void,
  reject: (reason?: unknown) => void,
): void {
  if (error !== null && error !== undefined) {
    reject(error);
    return;
  }
  if (stats?.hasErrors() === true) {
    reject(new Error(stats.toString({ all: false, errors: true })));
    return;
  }
  resolve();
}
