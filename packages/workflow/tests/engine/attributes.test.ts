import { describe, expect, it } from "vitest";

import { createWorkflowClient } from "../../src/client/create.ts";
import { implementWorkflow } from "../../src/definition.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";

describe("workflow run attributes", () => {
  it("sets, removes, and filters external run attributes", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run-attributes" });
    const workflow = implementWorkflow({ name: "external-attributes" }, () => "ok");
    await engine.runWorkflowNow(workflow, undefined);

    await engine.setRunAttributes("run-attributes", {
      customer: "acme",
      priority: 3,
      ready: true,
      region: null,
    });
    await engine.setRunAttributes("run-attributes", {
      priority: undefined,
      ready: false,
    });

    await expect(engine.getRun("run-attributes")).resolves.toMatchObject({
      attributes: {
        customer: "acme",
        ready: false,
        region: null,
      },
    });
    await expect(
      engine.listRuns({ attributes: { customer: "acme", ready: false } }),
    ).resolves.toHaveLength(1);
    await expect(engine.listRuns({ attributeExists: "region" })).resolves.toHaveLength(1);
    await expect(engine.listRuns({ attributeMissing: "priority" })).resolves.toHaveLength(1);
    await expect(engine.listRuns({ attributes: { customer: "other" } })).resolves.toHaveLength(0);
  });

  it("exposes run handle and client attribute updates", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run-handle-attributes" });
    const client = createWorkflowClient({ engine });
    const workflow = implementWorkflow({ name: "handle-attributes" }, () => "ok");
    const handle = await engine.startWorkflow(workflow, undefined);

    await handle.setAttributes({ source: "handle" });
    await client.admin.setAttributes("run-handle-attributes", { source: "client", routed: true });

    await expect(engine.getRun("run-handle-attributes")).resolves.toMatchObject({
      attributes: { routed: true, source: "client" },
    });
  });

  it("records workflow-authored attributes durably and replays them", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run-step-attributes" });
    let attempts = 0;
    const workflow = implementWorkflow({ name: "step-attributes" }, async ({ step }) => {
      attempts++;
      await step.runData.setAttributes("classify", {
        customer: "acme",
        stage: "classified",
      });
      await step.message.wait({ messageId: "continue" });
      await step.runData.setAttributes("finish", {
        complete: true,
        stage: undefined,
      });
      return "ok";
    });

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });
    await engine.sendMessage("run-step-attributes", { messageId: "continue" });
    await engine.resumeWorkflow(workflow, "run-step-attributes");

    const run = await engine.getRun("run-step-attributes");
    expect(run?.attributes).toEqual({
      complete: true,
      customer: "acme",
    });
    expect(attempts).toBe(2);
    await expect(engine.getEvents("run-step-attributes")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "attributes_set",
          stepName: "classify",
          attributes: { customer: "acme", stage: "classified" },
        }),
        expect.objectContaining({
          kind: "attributes_set",
          stepName: "finish",
          attributes: { complete: true },
          removeAttributes: ["stage"],
        }),
      ]),
    );
  });

  it("rejects replayed workflow-authored attribute divergence", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: () => "run-step-attributes-divergence",
      now: () => now,
    });
    let stage = "classified";
    const workflow = implementWorkflow({ name: "step-attributes-divergence" }, async ({ step }) => {
      await step.runData.setAttributes("classify", {
        customer: "acme",
        stage,
      });
      await step.task.sleep("pause", Temporal.Duration.from({ seconds: 1 }));
      return "ok";
    });

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });

    stage = "changed";
    now = Temporal.Instant.from("2026-06-11T10:00:01Z");
    const result = await engine.resumeWorkflow(workflow, "run-step-attributes-divergence");

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") {
      throw new Error("Expected attribute replay divergence to fail the workflow");
    }
    expect(result.error.name).toBe("WorkflowReplayDivergenceError");
    await expect(engine.getRun("run-step-attributes-divergence")).resolves.toMatchObject({
      status: "failed",
      error: { name: "WorkflowReplayDivergenceError" },
    });
  });

  it("rejects invalid attributes and filters", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_attribute_validation" });
    const workflow = implementWorkflow({ name: "attribute-validation" }, () => "ok");

    await engine.runWorkflowNow(workflow, undefined);

    await expect(
      engine.setRunAttributes("run_attribute_validation", { $reserved: true }),
    ).rejects.toMatchObject({ name: "ZodError" });
    await expect(
      engine.setRunAttributes("run_attribute_validation", { invalid: Number.NaN }),
    ).rejects.toMatchObject({ name: "ZodError" });
  });
});
