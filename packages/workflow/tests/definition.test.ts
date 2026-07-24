import { ss } from "@temelj/standard-schema";
import { describe, expectTypeOf, test } from "vitest";

import type { WorkflowRunHandle } from "../src/types/client.ts";
import type { WorkflowDefinition, WorkflowImplementation } from "../src/types/definition.ts";
import type { WorkflowStepContext } from "../src/types/step.ts";

import { createWorkflowClient } from "../src/client/create.ts";
import { implementWorkflow, defineMessageChannel, defineWorkflow } from "../src/definition.ts";
import { defineWorkflowStep } from "../src/step-definition.ts";

describe("workflow public type contracts", () => {
  test("infers schema inputs and declared outputs from workflow defs", () => {
    const inputSchema = ss.object({
      userId: ss.string(),
    });

    const def = defineWorkflow<typeof inputSchema, { readonly ok: boolean }>({
      name: "typed-schema",
      schema: inputSchema,
    });

    expectTypeOf(def).toMatchTypeOf<
      WorkflowDefinition<{ readonly userId: string }, { readonly ok: boolean }, unknown>
    >();
  });

  test("preserves runnable, child workflow, and message payload types", () => {
    const client = createWorkflowClient();
    const parentDef = defineWorkflow<{ readonly userId: string }, { readonly ok: boolean }>({
      name: "typed-parent",
    });
    const childDef = defineWorkflow<{ readonly childId: string }, number>({
      name: "typed-child",
    });
    const typedStep = defineWorkflowStep(
      { name: "typed-step" },
      (value: number, suffix: string, context: WorkflowStepContext) => {
        expectTypeOf(context.step.name).toEqualTypeOf<string>();
        return `${value}${suffix}`;
      },
    );

    const runnable = client.workflow(parentDef, async ({ input, step }) => {
      expectTypeOf(input).toEqualTypeOf<{ readonly userId: string }>();

      const stepOutput = await step.task.call(typedStep, 1, "!");
      expectTypeOf(stepOutput).toEqualTypeOf<string>();

      // @ts-expect-error step arguments must match the step definition
      await step.task.call(typedStep, "1", "!");

      const childOutput = await step.workflow.run(childDef, { childId: input.userId });
      expectTypeOf(childOutput).toEqualTypeOf<number>();

      const childRunId = await step.workflow.start(childDef, { childId: input.userId });
      expectTypeOf(childRunId).toEqualTypeOf<string>();

      const hook = step.hook.create({
        name: "approval",
        schema: ss.object({
          approved: ss.boolean(),
        }),
      });
      expectTypeOf(hook.token).toEqualTypeOf<string>();
      expectTypeOf(await hook.wait()).toEqualTypeOf<{ readonly approved: boolean }>();
      expectTypeOf(await hook).toEqualTypeOf<{ readonly approved: boolean }>();

      const signalPayload = await step.message.wait({
        messageId: "approved",
        schema: ss.object({
          approved: ss.boolean(),
        }),
      });
      expectTypeOf(signalPayload).toEqualTypeOf<{ readonly approved: boolean }>();

      const channel = defineMessageChannel({
        name: "typed-channel",
        schema: ss.object({
          approved: ss.boolean(),
        }),
      });
      const channelPayload = await step.message.wait(channel);
      expectTypeOf(channelPayload).toEqualTypeOf<{ readonly approved: boolean }>();
      await step.message.send(childRunId, channel, { payload: { approved: true } });

      // @ts-expect-error channel payload must match the channel schema output
      await step.message.send(childRunId, channel, { payload: { approved: "yes" } });

      await step.task.run(
        // @ts-expect-error rollback handlers are not part of the core step config
        { name: "unsupported-rollback", rollback: () => undefined },
        () => undefined,
      );

      // @ts-expect-error step definitions are the only accepted step.task.call target
      await step.task.call({ name: "not-a-definition" });

      return { ok: signalPayload.approved };
    });

    expectTypeOf(runnable.run({ userId: "user_1" })).toEqualTypeOf<
      Promise<WorkflowRunHandle<{ readonly ok: boolean }>>
    >();
    expectTypeOf(client.runs.start(parentDef, { userId: "user_1" })).toEqualTypeOf<
      Promise<WorkflowRunHandle<{ readonly ok: boolean }>>
    >();

    // @ts-expect-error input shape must match the workflow def
    void client.runs.start(parentDef, { count: 1 });

    expectTypeOf<ReturnType<typeof client.hooks.resume>>().toEqualTypeOf<Promise<void>>();
  });

  test("preserves local workflow handler input and output types", () => {
    const workflow = implementWorkflow<{ readonly value: number }, string>(
      { name: "typed-local" },
      ({ input }) => {
        expectTypeOf(input).toEqualTypeOf<{ readonly value: number }>();
        return input.value.toString();
      },
    );

    expectTypeOf(workflow).toMatchTypeOf<
      WorkflowImplementation<{ readonly value: number }, string, { readonly value: number }>
    >();
  });

  test("exposes client.workflow as a runnable facade", () => {
    const client = createWorkflowClient();
    const def = defineWorkflow<{ readonly value: number }, string>({
      name: "typed-facade",
    });
    const runnable = client.workflow(def, ({ input }) => input.value.toString());

    expectTypeOf(runnable.definition).toEqualTypeOf<
      WorkflowDefinition<{ readonly value: number }, string, { readonly value: number }>
    >();
    expectTypeOf(runnable.run({ value: 1 })).toEqualTypeOf<Promise<WorkflowRunHandle<string>>>();
  });
});
