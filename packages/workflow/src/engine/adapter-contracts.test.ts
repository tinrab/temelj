import {
  ss,
  validateStandardSchema,
  StandardSchemaValidationError,
  type Schema,
} from "@temelj/standard-schema";
import { describe, expect, test } from "vitest";

import type { WorkflowClient } from "../types/client.ts";
import type { ResumeHookOptions } from "../types/hook.ts";
import type { RunId } from "../types/ids.ts";
import type { StreamChunk } from "../types/stream.ts";
import type { WorkflowWorker as WorkflowWorkerContract } from "../types/worker.ts";
import type { TransformManifest } from "../vite.ts";

import { clientForEngine } from "../client/create.ts";
import { implementWorkflow } from "../definition.ts";
import { Registry } from "../registry.ts";
import { makeGeneratedName, transformWorkflowSource } from "../vite.ts";
import { WorkflowWorker } from "../worker/worker.ts";
import { createWorkflowEngine } from "./create.ts";

describe("workflow adapter contracts", () => {
  test("framework HTTP adapters can resume webhooks through public clients", async () => {
    let webhookToken: string | undefined;
    const engine = createWorkflowEngine({ createRunId: () => "run_adapter_webhook" });
    const registry = new Registry();
    const client = clientForEngine(engine, { registry });

    const workflow = implementWorkflow<undefined, string>(
      { name: "adapter-webhook" },
      async ({ step }) => {
        const webhook = step.hook.createWebhook({
          schema: ss.object({ ok: ss.boolean() }),
          name: "callback",
          messageId: "callback.received",
        });

        webhookToken = webhook.token;
        const payload = await webhook;

        return payload.ok ? "ok" : "failed";
      },
    );

    const handle = await engine.runWorkflow(workflow, undefined);
    await expect(engine.resumeWorkflow(workflow, handle.runId)).resolves.toMatchObject({
      kind: "waiting",
    });

    if (webhookToken === undefined) {
      throw new Error("Expected webhook token");
    }

    await expect(
      handleWebhook(client, {
        token: webhookToken,
        payload: { ok: true },
        idempotencyKey: "callback_1",
      }),
    ).resolves.toEqual({ status: 202 });
    await expect(engine.resumeWorkflow(workflow, handle.runId)).resolves.toMatchObject({
      kind: "completed",
      output: "ok",
    });
  });

  test("stream transport adapters can pump persisted chunks through public readers", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_adapter_stream" });
    const registry = new Registry();
    const client = clientForEngine(engine, { registry });

    const workflow = implementWorkflow<undefined, string>(
      { name: "adapter-stream" },
      async ({ step }) => {
        const stream = step.stream.create<string>("log");
        await stream.write("one");
        await stream.write("two");
        await stream.close();

        return "done";
      },
    );

    const chunks: StreamChunk<string>[] = [];

    const handle = await engine.runWorkflow(workflow, undefined);
    await expect(engine.resumeWorkflow(workflow, handle.runId)).resolves.toMatchObject({
      kind: "completed",
      output: "done",
    });
    await pumpStream(client, handle.runId, "log", ss.string(), {
      async write(chunk) {
        chunks.push(chunk);
      },
      async close() {},
      async fail(error) {
        throw error;
      },
    });

    expect(chunks.map((chunk) => chunk.value)).toEqual(["one", "two"]);
    await expect(
      pumpStream(client, handle.runId, "log", ss.number(), {
        async write() {
          throw new Error("Invalid chunk reached the sink");
        },
        async close() {},
        async fail(error) {
          throw error;
        },
      }),
    ).rejects.toThrow(StandardSchemaValidationError);
  });

  test("build adapters can pass transform manifests across files", () => {
    const transformed = transformFiles(
      [
        {
          id: "/repo/steps.ts",
          code: `
export async function load(input: string) {
  "use step";
  return input;
}
`,
        },
        {
          id: "/repo/workflow.ts",
          code: `
import { load } from "./steps.ts";

export async function run(input: string) {
  "use workflow";
  return await load(input);
}
`,
        },
      ],
      "/repo",
    );

    expect(transformed[1]?.code).toContain(makeGeneratedName("callWorkflowStepFunction"));
  });

  test("worker host adapters can stop workers through the public lifecycle", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_adapter_worker" });
    const registry = new Registry();

    const worker = new WorkflowWorker({
      engine,
      registry,
      workerId: "worker_adapter",
      leaseDuration: Temporal.Duration.from({ milliseconds: 1_000 }),
    });

    const controller = new AbortController();
    const running = runWorkerHost(worker, controller.signal);
    controller.abort();
    await expect(running).resolves.toBeUndefined();
    await expect(worker.stop()).resolves.toBeUndefined();
  });
});

interface InboundWebhookRequest {
  readonly token: string;
  readonly payload: unknown;
  readonly idempotencyKey?: string;
}

async function handleWebhook(
  client: WorkflowClient,
  request: InboundWebhookRequest,
): Promise<{ readonly status: number }> {
  const options: ResumeHookOptions = { payload: request.payload };

  if (request.idempotencyKey !== undefined) {
    Object.assign(options, {
      idempotencyKey: request.idempotencyKey,
    } satisfies Partial<ResumeHookOptions>);
  }

  await client.hooks.resume(request.token, options);

  return { status: 202 };
}

interface StreamSink<TChunk> {
  write(chunk: StreamChunk<TChunk>): Promise<void>;
  close(): Promise<void>;
  fail(cause: unknown): Promise<void>;
}

async function pumpStream<TChunk>(
  client: WorkflowClient,
  runId: RunId,
  stream: string,
  schema: Schema<unknown, TChunk>,
  sink: StreamSink<TChunk>,
): Promise<void> {
  let fromIndex = 0;

  while (true) {
    const state = await client.streams.read(runId, stream, { fromIndex });

    for (const chunk of state.chunks) {
      const value = await validateStandardSchema(schema, chunk.value);
      await sink.write({ ...chunk, value });
      fromIndex = chunk.index + 1;
    }

    if (state.status === "closed") {
      await sink.close();

      return;
    }

    if (state.status === "failed") {
      await sink.fail(state.error);

      return;
    }

    throw new Error("Expected stream to reach a terminal state in this adapter test");
  }
}

function transformFiles(
  files: readonly { readonly id: string; readonly code: string }[],
  root: string,
): readonly { readonly id: string; readonly code: string }[] {
  const manifests: TransformManifest[] = [];

  return files.map((file) => {
    const result = transformWorkflowSource(file.code, file.id, {
      root,
      manifests,
    });

    if (result === undefined) {
      return file;
    }

    manifests.push(result.manifest);

    return { id: file.id, code: result.code };
  });
}

async function runWorkerHost(worker: WorkflowWorkerContract, signal: AbortSignal): Promise<void> {
  const running = worker.run({
    status: ["pending", "waiting", "running"],
    concurrency: 4,
    pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
    maxRuns: 1,
  });

  signal.addEventListener("abort", () => void worker.stop(), { once: true });
  await running;
}
