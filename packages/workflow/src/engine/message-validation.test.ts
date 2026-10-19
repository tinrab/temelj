import { describe, expect, test } from "vitest";
import { z } from "zod";

import { clientForEngine } from "../client/create.ts";
import { defineMessageChannel, implementWorkflow } from "../definition.ts";
import { createWorkflowEngine } from "./create.ts";

describe("workflow message validation", () => {
  test.each(["message", "hook", "webhook", "channel"] as const)(
    "replays %s schema transforms from the original payload",
    async (kind) => {
      const engine = createWorkflowEngine({ createRunId: () => "message-transform" });
      const client = clientForEngine(engine);
      const schema = z.string().transform((value) => Number(value) + 1);
      const channel = defineMessageChannel({ name: "value", schema });

      const workflow = implementWorkflow<undefined, number>(
        { name: "message-transform" },
        async ({ step }) => {
          const value = await (kind === "hook"
            ? step.hook.create({ name: "value", schema })
            : kind === "webhook"
              ? step.hook.createWebhook({ name: "value", schema })
              : kind === "channel"
                ? step.message.wait(channel)
                : step.message.wait({ messageId: "value", schema }));

          await step.message.wait({ messageId: "finish" });

          return value;
        },
      );

      await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
        kind: "waiting",
      });

      if (kind === "channel") {
        await client.messages.send("message-transform", channel, { payload: "41" });
      } else {
        await client.messages.send("message-transform", { messageId: "value", payload: "41" });
      }

      await expect(engine.resumeWorkflow(workflow, "message-transform")).resolves.toMatchObject({
        kind: "waiting",
      });
      await client.messages.send("message-transform", { messageId: "finish" });
      await expect(engine.resumeWorkflow(workflow, "message-transform")).resolves.toMatchObject({
        kind: "completed",
        output: 42,
      });

      const events = await engine.store.getEvents("message-transform");
      expect(
        events.find(
          (event) => event.kind === "message_wait_completed" && event.messageId === "value",
        ),
      ).toMatchObject({ payload: "41" });
      await engine.close();
    },
  );
  test("records schema rejection before a hook payload reaches workflow code", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "invalid-hook" });
    const client = clientForEngine(engine);

    const workflow = implementWorkflow<undefined, boolean>(
      { name: "invalid-hook" },
      async ({ step }) => {
        const payload = await step.hook.create({
          name: "approval",
          schema: z.object({ approved: z.boolean() }),
        });

        return payload.approved;
      },
    );

    await engine.runWorkflowNow(workflow, undefined);
    await client.messages.send("invalid-hook", {
      messageId: "approval",
      payload: { approved: "yes" },
    });
    await expect(engine.resumeWorkflow(workflow, "invalid-hook")).resolves.toMatchObject({
      kind: "failed",
    });
    const events = await engine.store.getEvents("invalid-hook");
    expect(events.some((event) => event.kind === "message_wait_failed")).toBe(true);
    expect(events.some((event) => event.kind === "message_wait_completed")).toBe(false);
    await engine.close();
  });
});
