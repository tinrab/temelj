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

A workflow is a function whose progress is recorded as durable events. When a run
stops, for a sleep, a message wait, a retry, or a crash, a worker later replays
the recorded events and continues where the run left off. Completed steps are not
executed again; their recorded results are returned instead.

Runs, events, schedules, and locks live in any `@temelj/storage` backend. The
default is in-memory storage.

## Quick start

```ts
import { createWorkflowClient, implementWorkflow } from "@temelj/workflow";

const greet = implementWorkflow<{ readonly name: string }, string>(
  { name: "greet", version: "v1" },
  async ({ input, step }) => {
    return await step.run({ name: "build-greeting" }, () => `Hello, ${input.name}`);
  },
);

const client = createWorkflowClient();
client.register(greet);

const handle = await client.runs.start(greet, { name: "Ada" });
await client.workers.processRun(handle.runId);
console.log(await handle.result()); // "Hello, Ada"
```

`client.workers.processRun` executes one run in place. A long-running process
starts a worker instead, which claims and executes runs until stopped:

```ts
const worker = client.workers.create();
await worker.run({ concurrency: 8 });
```

## Writing workflows

There are two ways to write a workflow.

**Definitions.** `implementWorkflow` takes a name, an optional version, an
optional input schema, and a handler. The handler receives the input and `step`,
which records every durable command:

| Command                                                  | Records                                |
| -------------------------------------------------------- | -------------------------------------- |
| `step.run`, `step.call`                                  | a step's result, with retries          |
| `step.sleep`, `step.sleepUntil`                          | a timer                                |
| `step.workflow.start`, `step.workflow.run`               | a child run                            |
| `step.message.send`, `step.message.wait`                 | a message between runs                 |
| `step.hook.create`, `step.hook.createWebhook`            | a wait for an external resume token    |
| `step.stream.create`                                     | a stream of chunks readers can follow  |
| `step.lock.acquire`, `step.lock.with`                    | a lease on a named lock                |
| `step.deterministic.now`, `.uuid`, `.random`, ...        | a value that must not change on replay |
| `step.runData.setMetadata`, `step.runData.setAttributes` | run metadata and searchable attributes |

`defineWorkflowStep` declares a reusable step. Its handler receives a step
context first, then the arguments passed to `step.call`:

```ts
const charge = defineWorkflowStep({ name: "charge" }, ({ log }, amount: number) => {
  log.info("charging", { amount });
  return amount;
});

const charged = await step.call(charge, 1299);
```

**Directives.** With a bundler plugin, plain async functions become workflows and
steps:

```ts
export async function chargeOrder(amount: number): Promise<number> {
  "use step";
  return amount;
}

export async function checkout(amount: number): Promise<number> {
  "use workflow";
  return await chargeOrder(amount);
}
```

`client.runs.start(checkout, 1299)` registers and starts a compiled workflow. Plugins are available for Vite, Rollup, Rolldown, esbuild, webpack,
and Rspack:

```ts
import { workflow } from "@temelj/workflow/vite";

export default { plugins: [workflow()] };
```

A workflow name and version identify its input, output, and recorded commands.
Use a new version when they change, since replay restores the results recorded
for a run's version.

## Messages and hooks

A message channel pairs a name with a payload schema. Sends accept the schema's
input type, and waits return its output type:

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

Hooks wait for an external system. `step.hook.create` returns a hook whose
`token` you hand out; `client.hooks.resume(token, { payload })` resumes the run.
Webhooks are created with `step.hook.createWebhook` and resumed the same way: the token
records which kind it is. `parseHookToken(token)` decodes a token without resuming it.

A recorded payload is validated again on every replay, so a schema transform
always receives the same input.

## Observing runs

The client emits lifecycle and operation events in process:

```ts
const unsubscribe = client.on("workflow:run-completed", ({ run }) => {
  console.log("completed", run.id);
});
```

## Errors

Workflow, step, and option failures are `WorkflowError`s with a `code` from
`WorkflowErrorCode`. A failed run stores its error as a record, so check codes with
`matchesWorkflowError`, which accepts live errors and stored records alike:

```ts
import { matchesWorkflowError, WorkflowErrorCode } from "@temelj/workflow";

if (matchesWorkflowError(run.error, WorkflowErrorCode.LOCK_ALREADY_HELD, { key: "invoice:1" })) {
  // ...
}
```

Throw `WorkflowRetryableError` from a step or workflow to retry it, optionally with
`retryAt` or `retryDelay`, and `WorkflowNonRetryableError` to fail it without retries.

## Stored values

Inputs, outputs, metadata, payloads, and stream chunks are stored as
`StorageValue` from `@temelj/storage`: JSON-like data plus dates, Temporal
values, byte arrays, maps, and sets. Functions, symbols, sparse arrays, and
cycles are rejected before anything is written.

A run ID alone does not say what type a run returns, so
`client.runs.getHandle(runId)` and stream readers return `StorageValue`.
Validate such values with a schema before using them as an application type.

## Storage

Pass any `@temelj/storage` backend to the client:

```ts
import { createStorage } from "@temelj/storage";
import { createWorkflowClient } from "@temelj/workflow";

const client = createWorkflowClient({ storage: createStorage(/* backend */) });
```

The engine adapts to what the storage supports, such as conditional writes, and
`@temelj/workflow/store` exposes the store contract for custom adapters.

## Cloudflare Workflows

`@temelj/workflow/cloudflare` runs the same workflow definitions on Cloudflare
Workflows:

```ts
import { createCloudflareWorkflowHost } from "@temelj/workflow/cloudflare";

const cloudflare = createCloudflareWorkflowHost<Env>({ workflows });

export class TemeljWorkflow extends cloudflare.Entrypoint {}

const runtime = cloudflare.createRuntime(env.TEMELJ_WORKFLOW);
const handle = await runtime.runs.start(greetingWorkflow, { name: "Ada" });
```

The Cloudflare runtime and the local client share the `WorkflowRuntime` interface:
`runs.start`, `register`, and `close`, with handles that report `status`, wait for `result`,
and `cancel`. Code written against it runs on either host. Each host adds what it supports:
the local client has schedules, locks, workers, streams, and run history, and the Cloudflare
runtime has `runs.get(workflow, runId)` and `messages.send`. Inputs travel in a serialized envelope and are validated against the workflow's
schema before execution.

## OpenTelemetry

```ts
import { createOpenTelemetryTelemetry } from "@temelj/workflow/otel";

const client = createWorkflowClient({ telemetry: createOpenTelemetryTelemetry() });
```

Runs, steps, messages, and storage operations produce spans and metrics, and
workflow logs carry the run and step identity.
