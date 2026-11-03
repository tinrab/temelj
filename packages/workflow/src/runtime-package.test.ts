import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const execFile = promisify(execFileCallback);

test(
  "runs a packed runtime without compiler integrations installed",
  { timeout: 120000 },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "temelj-workflow-runtime-package-"));

    try {
      await execFile("pnpm", ["pack", "--pack-destination", directory], {
        cwd: path.resolve(import.meta.dirname, ".."),
        timeout: 30000,
      });
      const archive = (await readdir(directory)).find((name) => name.endsWith(".tgz"));

      if (archive === undefined) throw new Error("Missing packed workflow archive");
      await writeFile(
        path.join(directory, "package.json"),
        JSON.stringify({
          private: true,
          type: "module",
          dependencies: { "@temelj/workflow": "file:./" + archive },
          devDependencies: { "@types/node": "26.6.5" },
        }),
      );
      await execFile("pnpm", ["install", "--prod", "--ignore-scripts"], {
        cwd: directory,
        timeout: 60000,
      });
      const installed = await readdir(path.join(directory, "node_modules", ".pnpm"));
      expect(
        installed.filter((name) =>
          /^(?:oxc-parser|unplugin|vite|esbuild|rolldown|rollup|webpack|typescript)@/.test(name),
        ),
      ).toEqual([]);
      await writeFile(
        path.join(directory, "consumer.mjs"),
        `
import assert from "node:assert/strict";
import { createWorkflowClient, implementWorkflow, isWorkflowControlFlowSignal } from "@temelj/workflow";
import { createWorkflowStore } from "@temelj/workflow/store";
const workflow = implementWorkflow({ name: "packed-runtime", version: "v1" },
  ({ step }) => step.run({ name: "checkpoint" }, () => "completed"));
let now = Temporal.Instant.from("2025-01-01T00:00:00Z");
const client = createWorkflowClient({ store: createWorkflowStore({ namespace: "packed-runtime" }), now: () => now });
try {
  const handle = await client.runs.start(workflow, {});
  await client.workers.processRun(handle.runId);
  assert.equal(await handle.result(), "completed");
  const delayed = implementWorkflow({ name: "wrapped-suspension", version: "v1" }, async ({ step }) => {
    try {
      await step.sleep("pause", Temporal.Duration.from({ seconds: 1 }));
      return "resumed";
    } catch (cause) {
      if (isWorkflowControlFlowSignal(cause)) throw cause;
      throw new Error("Unexpected workflow failure", { cause });
    }
  });
  const waiting = await client.runs.start(delayed, {});
  await client.workers.processRun(waiting.runId);
  assert.equal((await client.runs.get(waiting.runId))?.status, "waiting");
  now = now.add({ seconds: 2 });
  await client.workers.processRun(waiting.runId);
  assert.equal(await waiting.result(), "resumed");
} finally { await client.close(); }
for (const name of ["oxc-parser", "unplugin"]) {
  let absent = false;
  try { import.meta.resolve(name); } catch (cause) { if (cause.code !== "ERR_MODULE_NOT_FOUND") throw cause; absent = true; }
  assert(absent, name + " leaked into the runtime installation");
}
`,
      );
      await execFile(process.execPath, ["consumer.mjs"], {
        cwd: directory,
        timeout: 30000,
      });
      await writeFile(
        path.join(directory, "consumer.ts"),
        `
import { createWorkflowClient, implementWorkflow, type WorkflowClient } from "@temelj/workflow";
import { createWorkflowStore } from "@temelj/workflow/store";
const work = implementWorkflow<{ name: string }, string>({ name: "typed-runtime", version: "v1" },
  ({ input, step }) => step.run({ name: "checkpoint" }, () => input.name));
const client: WorkflowClient = createWorkflowClient({ store: createWorkflowStore() });
export async function execute(): Promise<string> {
  const handle = await client.runs.start(work, { name: "typed" });
  await client.workers.processRun(handle.runId);
  return await handle.result();
}
`,
      );
      await execFile("pnpm", ["install", "--ignore-scripts"], { cwd: directory, timeout: 60000 });
      await execFile(
        process.execPath,
        [
          fileURLToPath(new URL("./bin/tsc", import.meta.resolve("typescript/package.json"))),
          "--noEmit",
          "--strict",
          "--module",
          "NodeNext",
          "--target",
          "ESNext",
          "--lib",
          "ESNext,DOM",
          "consumer.ts",
        ],
        { cwd: directory, timeout: 30000 },
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
