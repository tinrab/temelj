import { describe, expect, test } from "vitest";

import { createWorkflowClient } from "../../src/client/create.ts";
import { implementWorkflow, defineWorkflow } from "../../src/definition.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";
import { defineWorkflowStep } from "../../src/step-definition.ts";
import { sequentialRunIds } from "../utility.ts";

describe("Vercel workflow patterns on Temelj primitives", () => {
  test("starts a workflow and tracks it through the run handle", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_pattern_start" });
    const client = createWorkflowClient({ engine });
    const def = defineWorkflow<string, { readonly message: string }>({
      name: "pattern-start",
    });
    const workflow = client.workflow(def, ({ input }) => ({
      message: `hello ${input}`,
    }));

    const run = await workflow.run("Ada", { idempotencyKey: "hello:Ada" });

    expect(run.runId).toBe("run_pattern_start");
    await expect(run.status()).resolves.toBe("pending");
    await client.workers.processRun(run.runId);
    await expect(
      run.result({
        timeout: Temporal.Duration.from({ milliseconds: 0 }),
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).resolves.toEqual({
      message: "hello Ada",
    });
    await expect(run.status()).resolves.toBe("completed");
  });

  test("fans out independent step definitions with Promise.allSettled", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_pattern_fan_out" });
    const sendSlack = defineWorkflowStep(
      { name: "send-slack" },
      (incidentId: string, _message: string) => ({ incidentId, channel: "slack" }),
    );
    const sendEmail = defineWorkflowStep(
      { name: "send-email" },
      (incidentId: string, _message: string) => ({ incidentId, channel: "email" }),
    );
    const sendSms = defineWorkflowStep(
      { name: "send-sms" },
      (incidentId: string, _message: string) => ({ incidentId, channel: "sms" }),
    );
    const workflow = implementWorkflow<
      { readonly incidentId: string; readonly message: string },
      { readonly incidentId: string; readonly delivered: number; readonly failed: number }
    >({ name: "pattern-fan-out" }, async ({ input, step }) => {
      const settled = await Promise.allSettled([
        step.task.call(sendSlack, input.incidentId, input.message),
        step.task.call(sendEmail, input.incidentId, input.message),
        step.task.call(sendSms, input.incidentId, input.message),
      ]);
      const delivered = settled.filter((result) => result.status === "fulfilled").length;
      return {
        incidentId: input.incidentId,
        delivered,
        failed: settled.length - delivered,
      };
    });

    await expect(
      engine.runWorkflowNow(workflow, {
        incidentId: "inc_1",
        message: "investigate",
      }),
    ).resolves.toMatchObject({
      kind: "completed",
      output: { incidentId: "inc_1", delivered: 3, failed: 0 },
    });
    await expect(engine.getEvents("run_pattern_fan_out")).resolves.toMatchObject([
      { kind: "workflow_started" },
      { kind: "step_started", stepId: "run:send-slack" },
      { kind: "step_started", stepId: "run:send-email" },
      { kind: "step_started", stepId: "run:send-sms" },
      { kind: "step_completed", stepId: "run:send-slack" },
      { kind: "step_completed", stepId: "run:send-email" },
      { kind: "step_completed", stepId: "run:send-sms" },
      { kind: "workflow_completed" },
    ]);
  });

  test("models saga compensation with ordinary try/catch control flow", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_pattern_saga" });
    const reserve = defineWorkflowStep({ name: "reserve-inventory" }, (orderId: string) => ({
      orderId,
      reservationId: `res_${orderId}`,
    }));
    const charge = defineWorkflowStep({ name: "charge-payment" }, (orderId: string) => ({
      orderId,
      chargeId: `ch_${orderId}`,
    }));
    const ship = defineWorkflowStep(
      { name: "ship-order", retry: { maximumAttempts: 1 } },
      (_orderId: string) => {
        throw new Error("carrier unavailable");
      },
    );
    const refund = defineWorkflowStep(
      { name: "refund-payment" },
      (chargeId: string) => `refunded:${chargeId}`,
    );
    const release = defineWorkflowStep(
      { name: "release-inventory" },
      (reservationId: string) => `released:${reservationId}`,
    );
    const workflow = implementWorkflow<string, { readonly status: "compensated" | "shipped" }>(
      { name: "pattern-saga" },
      async ({ input: orderId, step }) => {
        const reservation = await step.task.call(reserve, orderId);
        const payment = await step.task.call(charge, orderId);
        try {
          await step.task.call(ship, orderId);
          return { status: "shipped" };
        } catch {
          await Promise.all([
            step.task.call(refund, payment.chargeId),
            step.task.call(release, reservation.reservationId),
          ]);
          return { status: "compensated" };
        }
      },
    );

    await expect(engine.runWorkflowNow(workflow, "order_1")).resolves.toMatchObject({
      kind: "completed",
      output: { status: "compensated" },
    });
    const events = await engine.getEvents("run_pattern_saga");
    expect(events.filter((event) => event.kind === "step_failed")).toHaveLength(1);
    expect(
      events.filter((event) => event.kind === "step_completed").map((event) => event.stepName),
    ).toEqual(["reserve-inventory", "charge-payment", "refund-payment", "release-inventory"]);
  });

  test("waits for a human approval hook and resumes it with a client call", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_pattern_hook" });
    const client = createWorkflowClient({ engine });
    let token = "";
    const workflow = implementWorkflow<string, string>(
      { name: "pattern-human-approval" },
      async ({ input: documentId, step }) => {
        const approval = step.hook.create<{ readonly approved: boolean }>({
          name: `approve:${documentId}`,
          messageId: "document.approved",
        });
        token = approval.token;
        const payload = await approval;
        return payload.approved ? "approved" : "rejected";
      },
    );

    await expect(engine.runWorkflowNow(workflow, "doc_1")).resolves.toMatchObject({
      kind: "waiting",
    });
    await client.hooks.resume(token, {
      payload: { approved: true },
      idempotencyKey: "approval:doc_1",
    });

    await expect(engine.resumeWorkflow(workflow, "run_pattern_hook")).resolves.toMatchObject({
      kind: "completed",
      output: "approved",
    });
  });

  test("schedules the next workflow run with a stable idempotency key", async () => {
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run_pattern_schedule"),
      now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
    const client = createWorkflowClient({ engine });
    const reminder = defineWorkflow<{ readonly userId: string }, string>({
      name: "pattern-reminder",
    });

    const run = await client.schedules.next(
      reminder,
      { userId: "user_1" },
      {
        every: Temporal.Duration.from({ days: 1 }),
        from: Temporal.Instant.from("2026-06-11T10:00:00Z"),
        idempotencyKey: "reminder:user_1:2026-06-12",
      },
    );

    expect(run.runId).toBe("run_pattern_schedule");
    await expect(run.getRun()).resolves.toMatchObject({
      input: { userId: "user_1" },
      availableAt: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      idempotencyKey: "reminder:user_1:2026-06-12",
      status: "pending",
    });
  });
});
