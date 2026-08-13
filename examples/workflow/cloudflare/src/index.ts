import {
  createCloudflareWorkflowHost,
  type CloudflareWorkflowBinding,
} from "@temelj/workflow/cloudflare";

import type { GreetingInput } from "./workflows.ts";

import { greetingWorkflow, workflows } from "./workflows.ts";

export interface Env {
  readonly TEMELJ_WORKFLOW: CloudflareWorkflowBinding;
}

const cloudflare = createCloudflareWorkflowHost<Env>({ workflows });

export class TemeljWorkflow extends cloudflare.Entrypoint {}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const runtime = cloudflare.createRuntime(env.TEMELJ_WORKFLOW);
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/runs") {
      const input = await parseGreetingInput(request);
      if (input instanceof Response) {
        return input;
      }
      const handle = await runtime.start(greetingWorkflow, input);
      return Response.json(
        {
          runId: handle.runId,
          statusUrl: new URL(`/runs/${handle.runId}`, url).toString(),
        },
        { status: 202 },
      );
    }

    const approvalRunId = approvalRunIdFromPath(url.pathname);
    if (request.method === "POST" && approvalRunId !== undefined) {
      await runtime.messages.send(approvalRunId, {
        messageId: "approval",
        payload: true,
      });
      return Response.json({ runId: approvalRunId, approved: true });
    }

    const runId = runIdFromPath(url.pathname);
    if (request.method === "GET" && runId !== undefined) {
      const handle = await runtime.runs.get(greetingWorkflow, runId);
      const status = await handle.status();
      if (status !== "completed") {
        return Response.json({ runId, status });
      }
      return Response.json({
        runId,
        status,
        result: await handle.result(),
      });
    }

    return Response.json({
      usage: {
        start: 'POST /runs with JSON { "name": "Ada", "waitForApproval": false }',
        approve: "POST /runs/:runId/approve",
        inspect: "GET /runs/:runId",
      },
    });
  },
};

async function parseGreetingInput(request: Request): Promise<GreetingInput | Response> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body" }, { status: 400 });
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("name" in value) ||
    typeof value.name !== "string" ||
    value.name.trim().length === 0
  ) {
    return Response.json(
      { error: "Expected a non-empty string property named `name`" },
      {
        status: 400,
      },
    );
  }
  const waitForApproval = "waitForApproval" in value ? value.waitForApproval : undefined;
  if (waitForApproval !== undefined && typeof waitForApproval !== "boolean") {
    return Response.json(
      { error: "Expected `waitForApproval` to be a boolean when provided" },
      { status: 400 },
    );
  }
  return {
    name: value.name.trim(),
    waitForApproval: waitForApproval ?? false,
  };
}

function runIdFromPath(pathname: string): string | undefined {
  const match = /^\/runs\/([^/]+)$/.exec(pathname);
  return match?.[1];
}

function approvalRunIdFromPath(pathname: string): string | undefined {
  const match = /^\/runs\/([^/]+)\/approve$/.exec(pathname);
  return match?.[1];
}
