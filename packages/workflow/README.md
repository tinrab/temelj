<p align="center">
  <h1 align="center" style="text-decoration:none;">@temelj/workflow</h1>
  <br/>
  <p align="center">
    Durable, vendor-agnostic workflows for TypeScript.
  </p>
</p>

<p align="center">
  <a href="https://twitter.com/tinrab" rel="nofollow"><img src="https://img.shields.io/badge/created%20by-@tinrab-1d9bf0.svg" alt="Created by Tin Rabzelj"></a>
  <a href="https://jsr.io/@temelj/workflow" rel="nofollow"><img src="https://jsr.io/badges/@temelj/workflow" alt="jsr"></a>
  <a href="https://opensource.org/licenses/MIT" rel="nofollow"><img src="https://img.shields.io/github/license/tinrab/temelj" alt="License"></a>
</p>

<div align="center">
  <a href="https://jsr.io/@temelj/workflow">jsr</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://www.npmjs.com/package/@temelj/workflow">npm</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://github.com/tinrab/temelj/issues/new">Issues</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://twitter.com/tinrab">@tinrab</a>
  <br />
</div>

<br/>
<br/>

<p align="center">
🚨Alpha state; things are in high flux🚨
</p>

## Installation

```sh
# npm
$ npm install @temelj/workflow
# pnpm
$ pnpm add @temelj/workflow
```

## Overview

A workflow can pause and continue after a worker restarts.
The worker replays its event history, returning saved results for completed steps.
Code outside those steps runs again during replay.

The default client stores history in memory.
To retain runs across restarts, configure persistent [storage](#storage).

## Quick start

Implement a workflow:

```ts
import { implementWorkflow } from "@temelj/workflow";

export const greet = implementWorkflow<{ readonly name: string }, string>(
  { name: "greet", version: "v1" },
  ({ input, step }) => step.run({ name: "greeting" }, () => `Hello, ${input.name}`),
);
```

Start a run, then have a worker execute it:

```ts
import { createWorkflowClient } from "@temelj/workflow";

const client = createWorkflowClient();
const handle = await client.runs.start(greet, { name: "Verso" });
// Starting registers the implementation and stores a pending run.

await client.workers.processRun(handle.runId); // Process this run once.
console.log(await handle.result()); // "Hello, Verso"
await client.close();
```

`result()` waits for completion and it doesn't run the workflow.

A service can run a worker loop to claim pending runs and resume waits as they become ready:

```ts
import type { WorkflowClient } from "@temelj/workflow";

export async function runWorker(client: WorkflowClient, signal: AbortSignal): Promise<void> {
  // Register workflow implementations on this client before starting the worker.
  try {
    await client.workers.create().run({ concurrency: 8, signal });
  } finally {
    await client.close();
  }
}
```

Producers and workers must share the same storage.
Each in-memory client has its own runs.
Use a persistent backend when they run in separate processes.

You can find examples in [examples/workflow](../../examples/workflow).

## Writing workflows

Use `step.run()` for an inline task, or declare a reusable step with `defineWorkflowStep()`:

```ts
import { defineWorkflowStep, implementWorkflow } from "@temelj/workflow";

const formatGreeting = defineWorkflowStep({ name: "format-greeting" }, ({ log }, name: string) => {
  log.info("formatting greeting", { name });
  return `Hello, ${name}`;
});

export const reminder = implementWorkflow<{ readonly name: string }, string>(
  { name: "reminder", version: "v1" },
  async ({ input, step }) => {
    const greeting = await step.call(formatGreeting, input.name);
    await step.sleep("reminder-delay", Temporal.Duration.from({ minutes: 5 }));
    // The worker pauses here. On replay, formatGreeting returns its saved result.

    const sentAt = await step.deterministic.now("sent-at");
    step.log.info("reminder ready", { sentAt: sentAt.toString() });
    return greeting;
  },
);
```

We call this "Explicit API."

You should put network calls and external writes inside steps.
A step can run again if it fails or the worker stops before its result is saved, so make external writes idempotent.
Use `step.deterministic` for time or random values that affect later commands.
`step.log` suppresses repeated log lines during replay.

Note, this package avoids patching globals so you shouldn't use `Math.random()` or `Date.now()` if you want deterministic runs.

Workflows are versioned.
Keep command names and their order stable for a workflow version.
Give changed input contracts or command sequences a new version, and retain implementations needed by existing runs.

### Directive syntax

With the bundler plugin, directives turn ordinary async functions into workflows:

```ts
export async function createGreeting(name: string): Promise<string> {
  "use step";
  return `Hello, ${name}`;
}

export async function greetingWorkflow(name: string): Promise<string> {
  "use workflow";
  return await createGreeting(name);
}

// After the transform: await client.runs.start(greetingWorkflow, "Verso").
```

Configure the transform in your build, for example with Vite:

```ts
import { workflow } from "@temelj/workflow/vite";

export default { plugins: [workflow()] };
```

We call this alternative way of declaring workflows "directive" syntax that requires a bundler, which itself produces a "compiled workflow."

Adapters also exist for Rollup, Rolldown, esbuild, webpack, and Rspack.
See the [compiled example](../../examples/workflow/basic/src/compiled-workflows.ts).

Other commands use the same recorded history.
`step.workflow.run()` waits for a child workflow.
`step.workflow.start()` starts one without waiting for its result.
Use `step.lock.with()` for a leased lock and `step.stream.create()` to publish chunks a reader can follow.
`step.runData` records metadata and searchable attributes.
The [step API](./src/types/step.ts) lists their options.

## Observing runs

```ts
import { createWorkflowClient } from "@temelj/workflow";

const client = createWorkflowClient();
const unsubscribe = client.on("workflow:run-completed", ({ run }) => {
  console.log("completed", run.id); // In-process notification.
});

const handle = await client.runs.start(greet, { name: "Verso" });
await client.workers.processRun(handle.runId);
console.log(await handle.status()); // "completed"
console.log(await handle.events()); // Stored event history.
console.log(await handle.timeline()); // Steps and waits reconstructed from that history.

console.log(await client.runs.summary()); // Counts grouped by status and workflow.
console.log(await client.runs.recoverySummary()); // Due or stale runs that may need attention.
unsubscribe();
await client.close();
```

For an existing run, use `await client.runs.getHandle(runId)`.
Handles also expose `cancel()` and `streams`.
Use `handle.streams.follow(name)` to read chunk updates until that stream closes or fails.
Pass an abort signal to stop following early.

## Messages and hooks

This run pauses until an approval message arrives:

```ts
import { ss } from "@temelj/standard-schema";
import { createWorkflowClient, defineMessageChannel, implementWorkflow } from "@temelj/workflow";

const approval = defineMessageChannel({
  name: "approval",
  schema: ss.object({ approved: ss.boolean() }),
});
const review = implementWorkflow<undefined, boolean>(
  { name: "review" },
  async ({ step }) => (await step.message.wait(approval)).approved,
);

const client = createWorkflowClient();
const handle = await client.runs.start(review);
await client.workers.processRun(handle.runId);
console.log(await handle.status()); // "waiting"

// Send from an API handler or another process sharing the same storage.
await client.messages.send(handle.runId, approval, { payload: { approved: true } });
await client.workers.processRun(handle.runId); // Resume the waiting run.
console.log(await handle.result()); // true
await client.close();
```

For an external callback, create a hook and give its token to the caller:

```ts
import type { StepApi, WorkflowClient } from "@temelj/workflow";

import { ss } from "@temelj/standard-schema";

// Call inside a workflow handler.
async function waitForApproval(step: StepApi): Promise<boolean> {
  const hook = step.hook.create({
    name: "approval",
    schema: ss.object({ approved: ss.boolean() }),
  });
  await step.runData.setMetadata("callback-token", { token: hook.token });
  // The application can read the token from the run metadata and send it to the caller.
  return (await hook.wait()).approved;
}

// Call from the callback handler, using the token the application supplied.
async function approve(client: WorkflowClient, token: string): Promise<void> {
  await client.hooks.resume(token, { payload: { approved: true } });
}
```

`step.hook.createWebhook()` adds webhook metadata to the same token-based flow.
It doesn't create an actual HTTP endpoint.
`parseHookToken()` decodes a token without resuming the run.
Message payloads are validated again on replay, preserving the input to schema transforms.

## Errors

A retryable failure schedules another attempt according to the step's retry policy.

For example, retry a rate-limited HTTP request:

```ts
import {
  defineWorkflowStep,
  WorkflowNonRetryableError,
  WorkflowRetryableError,
} from "@temelj/workflow";

export const loadText = defineWorkflowStep(
  { name: "load-text", retry: { maximumAttempts: 3 } },
  async ({ signal }, url: string) => {
    const response = await fetch(url, { signal }); // Attempt cancellation or timeout.
    if (response.status === 429 || response.status >= 500) {
      throw new WorkflowRetryableError(`HTTP ${response.status}`, {
        retryDelay: Temporal.Duration.from({ seconds: 10 }),
      });
    }
    if (!response.ok) {
      throw new WorkflowNonRetryableError(`HTTP ${response.status}`);
    }
    return response.text();
  },
);
```

`WorkflowRetryableError` accepts `retryAt` or `retryDelay`.
Set one, not both.
`WorkflowNonRetryableError` fails without another attempt.

Stored failures are error records.
Match their codes with the same helper you use for live exceptions:

```ts
import { matchesWorkflowError, WorkflowErrorCode } from "@temelj/workflow";

export function isInvoiceLockConflict(error: unknown): boolean {
  return matchesWorkflowError(error, WorkflowErrorCode.LOCK_ALREADY_HELD, { key: "invoice:1" });
}
```

Workflow errors expose `code` and optional `details`.
Match those instead of parsing error messages.

## Stored values

Inputs and results use `StorageValue` from `@temelj/storage`.
That includes JSON-like data and values such as `Date`, `Map`, and `Uint8Array`.
Metadata and stream chunks included.

Functions, cyclic objects, sparse arrays and symbols are rejected before writing.

A typed workflow gives `runs.start()` a typed result.
A run ID alone doesn't establish an output type, so validate results read through `getHandle()`:

```ts
import type { WorkflowClient } from "@temelj/workflow";

import { ss } from "@temelj/standard-schema";

export async function readGreeting(client: WorkflowClient, runId: string): Promise<string> {
  const handle = await client.runs.getHandle(runId);
  return ss.parseSync(ss.string(), await handle.result());
}
```

Stream readers also return `StorageValue`.
Validate chunks before using their shape.

## Storage

This Node.js example stores run history on disk:

```ts
import { createStorage, createSuperJsonStorageCodec } from "@temelj/storage";
import { FileSystemStorageEngine } from "@temelj/storage/filesystem";
import { createWorkflowClient } from "@temelj/workflow";

function openClient() {
  return createWorkflowClient({
    storage: createStorage({
      codec: createSuperJsonStorageCodec({ format: "bytes" }),
      engine: new FileSystemStorageEngine({ directory: "./workflow-data" }),
    }),
  });
}

const first = openClient();
const handle = await first.runs.start(greet, { name: "Verso" });
await first.close(); // The pending run stays on disk.

const second = openClient();
second.register(greet); // Implementations live in code, not in storage.
await second.workers.processRun(handle.runId);
const recovered = await second.runs.getHandle(handle.runId);
console.log(await recovered.result()); // "Hello, Verso"
await second.close();
```

Use another [`@temelj/storage` backend](../storage/README.md) when needed.
`@temelj/workflow/store` exposes the store contract for custom adapters.

## Cloudflare Workflows

@temelj/workflow workflows can run on [Cloudflare Workflows](https://www.cloudflare.com/products/workflows/).

Define a host around the same `greet` implementation:

```ts
import type { CloudflareWorkflowBinding } from "@temelj/workflow/cloudflare";

import { defineWorkflowBundle } from "@temelj/workflow";
import { createCloudflareWorkflowHost } from "@temelj/workflow/cloudflare";

import { greet } from "./greet.ts";

interface Env {
  readonly TEMELJ_WORKFLOW: CloudflareWorkflowBinding;
}

const host = createCloudflareWorkflowHost<Env>({ workflows: defineWorkflowBundle([greet]) });
export class TemeljWorkflow extends host.Entrypoint {}

// Call from a Worker request handler with the configured workflow binding.
export async function startGreeting(env: Env) {
  const runtime = host.createRuntime(env.TEMELJ_WORKFLOW);
  return runtime.runs.start(greet, { name: "Verso" });
}
```

Configure the Worker binding and entrypoint as shown in the [Cloudflare example](../../examples/workflow/cloudflare/).

Both hosts implement `WorkflowRuntime`, so code using `runs.start()` and run handles can work with either.
The Cloudflare runtime also has `runs.get(workflow, runId)` and `messages.send()`.
Cloudflare manages worker execution.

> Note, some features from @temelj/workflow that Cloudflare doesn't support might throw an error.

## OpenTelemetry

Configure your OpenTelemetry SDK before creating the client:

```ts
import { createWorkflowClient } from "@temelj/workflow";
import { createOpenTelemetryTelemetry } from "@temelj/workflow/otel";

const client = createWorkflowClient({
  telemetry: createOpenTelemetryTelemetry({
    includeNamesInSpanNames: true, // Include workflow and step names in trace UIs.
    includeStorageOperationSpans: false, // Omit a span for each storage operation.
  }),
});

// Close the client when the worker stops.
await client.close();
```

The adapter emits workflow spans and metrics through your configured providers.
`@temelj/workflow/otel` exports the span and metric names, with attribute constants for queries.
Pass `forceFlush` and `shutdown` callbacks if the client should also flush and close your telemetry providers.
See the [instrumented example](../../examples/workflow/basic/src/instrumentation.ts) for SDK setup and exporter shutdown.

> Note, OTEL is experimental and how telemetry data is exported isn't yet strongly defined.
