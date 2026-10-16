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

## Installation

```sh
# npm
$ npm install @temelj/workflow
# pnpm
$ pnpm add @temelj/workflow
# jsr
$ deno add jsr:@temelj/workflow # or jsr add @temelj/workflow
```

## Overview

A workflow is a function whose progress is recorded as durable events. When a run pauses (for
a sleep, a message, a retry, or a crash), a worker later replays the events and continues where
it left off. Completed steps are not run again; replay returns their recorded results.

Runs, events, schedules, and locks are kept in any `@temelj/storage` backend, in memory by
default.

## Quick start

```ts
import { createWorkflowClient, implementWorkflow } from "@temelj/workflow";

const greet = implementWorkflow<{ readonly name: string }, string>(
  { name: "greet", version: "v1" },
  async ({ input, step }) => await step.run({ name: "greeting" }, () => `Hello, ${input.name}`),
);

const client = createWorkflowClient();

const handle = await client.runs.start(greet, { name: "Ada" });
await client.workers.processRun(handle.runId);
console.log(await handle.result()); // "Hello, Ada"
```

`runs.start` registers the implementation and records a pending run. `processRun` executes
one run in place; a long-lived process runs a worker that claims runs until it is stopped:

```ts
await client.workers.create().run({ concurrency: 8 });
```

The handle reports `status()`, waits for `result()`, reads `events()`, `timeline()`, and
`streams`, and can `cancel()` the run. `client.runs.getHandle(runId)` returns one for an existing
run.

## Writing workflows

**Definitions.** `implementWorkflow` takes a name, an optional version and input schema, and a
handler. The handler receives the input and `step`, which records every durable command:

| Command                                                  | Records                                |
| -------------------------------------------------------- | -------------------------------------- |
| `step.run`, `step.call`                                  | a step's result, with retries          |
| `step.sleep`, `step.sleepUntil`                          | a timer                                |
| `step.workflow.start`, `step.workflow.run`               | a child run                            |
| `step.message.send`, `step.message.wait`                 | a message between runs                 |
| `step.hook.create`, `step.hook.createWebhook`            | a wait for an external resume token    |
| `step.stream.create`                                     | a stream of chunks readers can follow  |
| `step.lock.acquire`, `step.lock.with`                    | a lease on a named lock                |
| `step.deterministic.now`, `.uuid`, `.random`, …          | a value that must not change on replay |
| `step.runData.setMetadata`, `step.runData.setAttributes` | run metadata and searchable attributes |

`step.log` is a logger that does not repeat lines while replaying. `defineWorkflowStep` declares
a reusable step; its handler receives a step context, then the arguments passed to `step.call`:

```ts
const charge = defineWorkflowStep({ name: "charge" }, ({ log }, amount: number) => {
  log.info("charging", { amount });
  return amount;
});

const charged = await step.call(charge, 1299);
```

**Directives.** With a bundler plugin, plain async functions become workflows and steps:

```ts
export async function chargeOrder(amount: number): Promise<number> {
  "use step";
  return amount;
}

export async function checkout(amount: number): Promise<number> {
  "use workflow";
  return await chargeOrder(amount);
}

// Elsewhere: await client.runs.start(checkout, 1299);
```

Plugins exist for Vite, Rollup, Rolldown, esbuild, webpack, and Rspack:

```ts
import { workflow } from "@temelj/workflow/vite";

export default { plugins: [workflow()] };
```

A workflow's name and version identify its input, output, and recorded commands. Bump the
version when they change, because replay restores the results recorded under a run's version.

## Messages and hooks

A message channel pairs a name with a payload schema. Senders pass the schema's input type and
waiters receive its output type:

```ts
import { ss } from "@temelj/standard-schema";
import { defineMessageChannel } from "@temelj/workflow";

const approval = defineMessageChannel({
  name: "approval",
  schema: ss.object({ approved: ss.boolean() }),
});

// Inside a workflow:
const { approved } = await step.message.wait(approval);

// From outside:
await client.messages.send(runId, approval, { payload: { approved: true } });
```

A hook waits for an external system. `step.hook.create()` (or `createWebhook()`) returns a hook
whose `token` you hand out, and `client.hooks.resume(token, { payload })` resumes the run.
`parseHookToken(token)` decodes a token without resuming it.

Recorded payloads are validated again on replay, so schema transforms always see the same input.

## Observing runs

The client emits lifecycle and operation events in process:

```ts
const unsubscribe = client.on("workflow:run-completed", ({ run }) => {
  console.log("completed", run.id);
});
```

`client.runs.summary()` counts runs by status, workflow, and wait kind, and
`client.runs.recoverySummary()` lists the runs that need attention: due, stale, failed, or
waiting on something that has resolved.

## Errors

Workflow, step, and option failures are `WorkflowError`s with a `code` from `WorkflowErrorCode`.
Failed runs store their error as a record, so match codes with `matchesWorkflowError`, which
accepts live errors and stored records:

```ts
import { matchesWorkflowError, WorkflowErrorCode } from "@temelj/workflow";

if (matchesWorkflowError(run.error, WorkflowErrorCode.LOCK_ALREADY_HELD, { key: "invoice:1" })) {
  // ...
}
```

Throw `WorkflowRetryableError` (optionally with `retryAt` or `retryDelay`) to retry a step or
workflow, and `WorkflowNonRetryableError` to fail it without retrying.

## Stored values

Inputs, outputs, metadata, payloads, and stream chunks are `StorageValue`s from
`@temelj/storage`: JSON-like data plus dates, Temporal values, byte arrays, maps, and sets.
Functions, symbols, sparse arrays, and cycles are rejected before anything is written.

A run ID does not carry a type, so `client.runs.getHandle(runId)` and stream readers return
`StorageValue`. Validate those values with a schema before trusting their shape.

## Storage

Pass any `@temelj/storage` backend to the client:

```ts
import { createStorage } from "@temelj/storage";
import { createWorkflowClient } from "@temelj/workflow";

const client = createWorkflowClient({ storage: createStorage(/* backend */) });
```

The engine adapts to what the storage supports, such as conditional writes.
`@temelj/workflow/store` exposes the store contract for custom adapters.

## Cloudflare Workflows

`@temelj/workflow/cloudflare` runs the same workflow definitions on Cloudflare Workflows:

```ts
import { defineWorkflowBundle } from "@temelj/workflow";
import { createCloudflareWorkflowHost } from "@temelj/workflow/cloudflare";

const cloudflare = createCloudflareWorkflowHost<Env>({ workflows: defineWorkflowBundle([greet]) });

export class TemeljWorkflow extends cloudflare.Entrypoint {}

const runtime = cloudflare.createRuntime(env.TEMELJ_WORKFLOW);
const handle = await runtime.runs.start(greet, { name: "Ada" });
```

Code written against the shared `WorkflowRuntime` interface (`runs.start`, `register`, `close`,
and handles with `status`, `result`, and `cancel`) runs on either host. Beyond that, the
Cloudflare runtime offers `runs.get(workflow, runId)` and `messages.send`; schedules, locks,
workers, streams, and run history are local-client features.

## OpenTelemetry

```ts
import { createOpenTelemetryTelemetry } from "@temelj/workflow/otel";

const client = createWorkflowClient({ telemetry: createOpenTelemetryTelemetry() });
```

Runs, steps, messages, and storage operations produce spans and metrics, and workflow logs carry
the run and step identity. `@temelj/workflow/otel` also exports the span, metric, and attribute
names for dashboards.
