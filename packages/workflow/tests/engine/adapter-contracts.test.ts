import { describe, expect, test } from "vitest";

import type { WorkflowClient } from "../../src/types/client.ts";
import type { StreamChunk } from "../../src/types/stream.ts";
import type { WorkflowWorker as WorkflowWorkerContract } from "../../src/types/worker.ts";
import type { TransformManifest } from "../../src/vite.ts";

import { createWorkflowClient } from "../../src/client/create.ts";
import { implementWorkflow } from "../../src/definition.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";
import { Registry } from "../../src/registry.ts";
import { RunId } from "../../src/types/run.ts";
import { makeGeneratedName, transformWorkflowSource } from "../../src/vite.ts";
import { WorkflowWorker } from "../../src/worker.ts";

describe("workflow adapter contracts", () => {
  test("framework HTTP adapters can resume webhooks through public clients", async () => {
    let webhookToken: string | undefined;
    const engine = createWorkflowEngine({ createRunId: () => "run_adapter_webhook" });
    const registry = new Registry();
    const client = createWorkflowClient({ engine, registry });
    const workflow = implementWorkflow<undefined, string>(
      { name: "adapter-webhook" },
      async ({ step }) => {
        const webhook = step.hook.createWebhook<{ readonly ok: boolean }>({
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
    const client = createWorkflowClient({ engine, registry });
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
    await pumpStream<string>(client, handle.runId, "log", {
      async write(chunk) {
        chunks.push(chunk);
      },
      async close() {},
      async fail(error) {
        throw error;
      },
    });

    expect(chunks.map((chunk) => chunk.value)).toEqual(["one", "two"]);
  });

  test("build adapters can pass transform manifests across files", () => {
    const transformed = transformWorkflowFiles(
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
    const running = runWorkflowWorkerHost(worker, controller.signal);
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
  await client.hooks.resumeWebhook(request.token, {
    payload: request.payload,
    ...(request.idempotencyKey === undefined ? {} : { idempotencyKey: request.idempotencyKey }),
  });

  return { status: 202 };
}

interface WorkflowStreamSink<TChunk> {
  write(chunk: StreamChunk<TChunk>): Promise<void>;
  close(): Promise<void>;
  fail(error: unknown): Promise<void>;
}

async function pumpStream<TChunk>(
  client: WorkflowClient,
  runId: RunId,
  stream: string,
  sink: WorkflowStreamSink<TChunk>,
): Promise<void> {
  let fromIndex = 0;

  while (true) {
    const state = await client.streams.read<TChunk>(runId, stream, { fromIndex });
    for (const chunk of state.chunks) {
      await sink.write(chunk);
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

function transformWorkflowFiles(
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

async function runWorkflowWorkerHost(
  worker: WorkflowWorkerContract,
  signal: AbortSignal,
): Promise<void> {
  const running = worker.run({
    status: ["pending", "waiting", "running"],
    concurrency: 4,
    pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
    maxRuns: 1,
  });

  signal.addEventListener("abort", () => void worker.stop(), { once: true });
  await running;
}
