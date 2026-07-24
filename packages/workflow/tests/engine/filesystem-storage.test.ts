import { createStorage, createSuperJsonStorageCodec } from "@temelj/storage";
import { FileSystemStorageEngine } from "@temelj/storage/filesystem";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { implementWorkflow } from "../../src/definition.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";
import { createWorkflowRuntime } from "../../src/runtime.ts";

const temporaryDirectories: string[] = [];

describe("filesystem-backed workflow runtime", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map(async (directory) => await rm(directory, { force: true, recursive: true })),
    );
  });

  test("resumes a pending run after recreating the runtime over the same storage", async () => {
    const directory = await temporaryDirectory();
    const workflow = implementWorkflow<{ readonly name: string }, string>(
      { name: "filesystem-runtime-recovery" },
      ({ input }) => `hello ${input.name}`,
    );

    const firstEngine = createWorkflowEngine({
      createRunId: () => "run_filesystem_recovery",
      storage: createFilesystemWorkflowStorage(directory),
    });
    const firstRuntime = createWorkflowRuntime({
      engine: firstEngine,
      workerEngine: firstEngine,
    });
    firstRuntime.register(workflow);
    const started = await firstRuntime.start(workflow, { name: "Ada" });
    await firstRuntime.close();

    const secondEngine = createWorkflowEngine({
      storage: createFilesystemWorkflowStorage(directory),
    });
    const secondRuntime = createWorkflowRuntime({
      engine: secondEngine,
      workerEngine: secondEngine,
    });
    secondRuntime.register(workflow);
    await secondRuntime.workers.processRun(started.runId);
    const recovered = await secondRuntime.runs.getHandle<string>(started.runId);

    await expect(recovered.result()).resolves.toBe("hello Ada");
    await secondRuntime.close();
  });
});

function createFilesystemWorkflowStorage(directory: string) {
  return createStorage({
    codec: createSuperJsonStorageCodec({ format: "bytes" }),
    engine: new FileSystemStorageEngine({
      directory,
      prefix: "workflow",
    }),
  });
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "temelj-workflow-runtime-"));
  temporaryDirectories.push(directory);
  return directory;
}
