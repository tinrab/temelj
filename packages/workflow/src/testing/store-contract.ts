import { createStorage, createSuperJsonStorageCodec } from "@temelj/storage";
import { FileSystemStorageEngine } from "@temelj/storage/filesystem";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";

import type { RunRecord } from "../types/run.ts";
import type { WorkflowStore } from "../types/store.ts";

import { createWorkflowStore } from "../store/create.ts";

/** A way to create a fresh store that every store contract runs against. */
interface StoreFactory {
  readonly name: string;
  readonly create: () => Promise<WorkflowStore>;
}

export const storeFactories: readonly StoreFactory[] = [
  {
    name: "default in-memory storage",
    create: async () => createWorkflowStore({ namespace: uniqueNamespace() }),
  },
  {
    name: "filesystem storage adapter",
    create: async () => {
      const directory = await mkdtemp(join(tmpdir(), "temelj-workflow-store-"));
      onTestFinished(async () => await rm(directory, { force: true, recursive: true }));

      return createWorkflowStore({
        namespace: uniqueNamespace(),
        storage: createStorage({
          codec: createSuperJsonStorageCodec({ format: "bytes" }),
          engine: new FileSystemStorageEngine({ directory, prefix: "workflow" }),
        }),
      });
    },
  },
];

export function pendingRun(
  store: WorkflowStore,
  id: string,
  options: Partial<RunRecord> = {},
): RunRecord {
  const { id: _id, namespace: _namespace, ...patch } = options;

  return {
    id,
    namespace: store.namespace,
    workflowName: "contract-workflow",
    workflowVersion: "v1",
    status: "pending",
    input: undefined,
    attempts: 0,
    createdAt: Temporal.Instant.from("2025-01-01T00:00:00Z"),
    updatedAt: Temporal.Instant.from("2025-01-01T00:00:00Z"),
    lastTransitionAt: Temporal.Instant.from("2025-01-01T00:00:00Z"),
    lastTransitionReason: "created",
    ...patch,
  };
}

function uniqueNamespace(): string {
  return `contract-${Temporal.Now.instant().epochMilliseconds.toString(36)}-${Math.random()}`;
}
