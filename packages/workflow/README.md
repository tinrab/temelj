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

## Persisted values

Run, hook, and stream metadata accept `StorageValue` from `@temelj/storage`.
Workflow persistence validates rich values before writing history, including
finite numbers, dates, Temporal values, byte arrays, maps, and sets. Functions,
symbol values, symbol keys, sparse arrays, and cycles are rejected.

The storage adapter removes undefined optional record fields before encoding,
including fields inside event arrays. It validates the remaining values instead
of casting records to a storage dictionary. Cloudflare transport encoding and
decoding apply the same value validation; a top-level `undefined` represents
absent input or a void result.

Cloudflare preserves the original workflow input in its transport envelope.
The input must be serializable, and the entrypoint validates it against the
workflow schema before execution. Schema transforms receive the original input.
Cloudflare starts require the registered definition for the requested version.
Result envelopes include the workflow name and version, and lookups reject a
result produced by a different workflow contract.

## Message and hook payloads

A message wait or hook without a schema returns `StorageValue | undefined`.
Supply a Standard Schema validator to infer a narrower payload type. Message
channels require a schema. Channel sends accept the schema input type; waits
return its output type. A schema whose input type is `unknown` validates the payload
at runtime. Caller-selected payload type arguments are not supported
for raw waits or hooks.

Each channel has a concrete message ID. Use a typed factory when the ID depends
on a key, then pass the resulting channel to `send`, `broadcast`, or `wait`:

```ts
import { defineMessageChannel } from "@temelj/workflow";
import { ss } from "@temelj/standard-schema";

const approvalFor = (requestId: string) =>
  defineMessageChannel({
    name: `approval.${requestId}`,
    schema: ss.object({ approved: ss.boolean() }),
  });

await client.messages.send(runId, approvalFor("123"), {
  payload: { approved: true },
});
```

```ts
import { ss } from "@temelj/standard-schema";

const approval = step.hook.create({
  name: "approval",
  schema: ss.object({ approved: ss.boolean() }),
});
const { approved } = await approval;
```

Completed message waits retain the original payload in history. Replay validates
that input again, so a schema transform receives the same input on every execution.

## Stored results and stream chunks

`runtime.runs.getHandle(runId)` returns a handle whose result is
`StorageValue | undefined`. A run ID does not establish an application output
type; validate the result with a schema before using it as one. The `run` field
in an execution result also remains a persisted record.

Schedule creation and updates validate input with the workflow schema before
persisting it. Schedule records expose this prepared value as
`StorageValue | undefined`; recurring runs reuse it without repeating the transform.

Stream readers return persisted chunks as `StorageValue | undefined`.
A stream ID alone does not establish a chunk's application type. Validate each
chunk before passing it to a consumer that requires a narrower type:

```ts
import { ss, validateStandardSchema } from "@temelj/standard-schema";

const updateSchema = ss.object({ text: ss.string() });
const stream = await client.streams.read(runId, "updates");

for (const chunk of stream.chunks) {
  const update = await validateStandardSchema(updateSchema, chunk.value);
  console.log(update.text);
}
```

## Reusable steps and registration

Reusable step handlers receive context first, followed by the arguments passed to
`step.task.call`. Argument and output types are inferred directly from the handler.

```ts
const greet = defineWorkflowStep({ name: "greet" }, ({ log }, name: string) => {
  log.info("greeting", { name });
  return `Hello, ${name}`;
});
const greeting = await step.task.call(greet, "Ada");
```

Compiled functions carry their definition as immutable, non-enumerable metadata.
A function can be attached to the same definition again, but cannot be reassigned
to another definition. Typed registry lookups require the original definition
object. Use `getByName` for lookups by name and version.

A workflow name and version identify its persistent input, output, and command
contracts. Use a new version when those contracts change. Replay restores the
validated results recorded for that version instead of executing completed
commands again.

`new Registry(entries)` accepts implementations and compiled functions together.
Bundles and Cloudflare hosts use the same registration checks.

## Client worker support

`createWorkflowEngine()` exposes its worker operations through `workerEngine`.
Clients use that capability when present. Custom client adapters can expose a
`workerEngine` or supply it in `createWorkflowClient` options. Without either,
client worker operations report that worker support is unavailable.

Telemetry observation arguments pair the event name with its payload type.
Forward observations with `observe: (...event) => target.observe?.(...event)`
to preserve that pairing. Run execution telemetry wraps an `ExecutionResult`;
step and storage telemetry can wrap other return values.
