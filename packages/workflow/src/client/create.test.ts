import { createStorage } from "@temelj/storage";
import { describe, expect, test } from "vitest";

import { attachWorkflowDefinition } from "../compiled-function.ts";
import { implementWorkflow } from "../definition.ts";
import { createWorkflowClient } from "./create.ts";

describe("workflow client", () => {
  test("uses the storage it is given without an explicit engine", async () => {
    const storage = createStorage();

    const greet = implementWorkflow<{ readonly name: string }, string>(
      { name: "client-storage" },
      ({ input }) => `Hello, ${input.name}`,
    );

    const first = createWorkflowClient({ storage });
    const handle = await first.runs.start(greet, { name: "Ada" });

    const second = createWorkflowClient({ storage });

    await expect(second.runs.get(handle.runId)).resolves.toMatchObject({ id: handle.runId });
  });

  test("registers implementations it starts and returns handles for existing runs", async () => {
    const client = createWorkflowClient();

    const greet = implementWorkflow<{ readonly name: string }, string>(
      { name: "client-handle" },
      ({ input }) => `Hello, ${input.name}`,
    );

    const started = await client.runs.start(greet, { name: "Ada" });
    await client.workers.processRun(started.runId);

    const handle = await client.runs.getHandle(started.runId);

    await expect(handle.result()).resolves.toBe("Hello, Ada");
  });

  test("starts compiled workflow functions", async () => {
    const client = createWorkflowClient();

    async function double(value: number): Promise<number> {
      return value * 2;
    }

    attachWorkflowDefinition(
      double,
      implementWorkflow<[value: number], number>({ name: "client-compiled" }, ({ input }) =>
        double(input[0]),
      ),
    );

    const handle = await client.runs.start(double, 21);
    await client.workers.processRun(handle.runId);

    await expect(handle.result()).resolves.toBe(42);
  });

  test("emits run lifecycle events to subscribers", async () => {
    const client = createWorkflowClient();
    const greet = implementWorkflow<undefined, string>({ name: "client-events" }, () => "done");
    const completed: string[] = [];
    client.on("workflow:run-completed", (event) => {
      completed.push(event.run.id);
    });

    const handle = await client.runs.start(greet, undefined);
    await client.workers.processRun(handle.runId);

    expect(completed).toEqual([handle.runId]);
  });
});
