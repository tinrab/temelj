import { expect, test } from "vitest";

import { isWorkflowControlFlowSignal, StaleExecutionError, Suspended } from "./signals.ts";

test("recognizes engine suspension and ownership loss without accepting lookalike errors", () => {
  const time = Temporal.Instant.from("2025-01-01T00:00:00Z");
  expect(isWorkflowControlFlowSignal(new Suspended(time))).toBe(true);
  expect(isWorkflowControlFlowSignal(new StaleExecutionError("run"))).toBe(true);
  const lookalike = new Error("ordinary failure");
  lookalike.name = "WorkflowSuspended";
  expect(isWorkflowControlFlowSignal(lookalike)).toBe(false);
  expect(isWorkflowControlFlowSignal({ name: "WorkflowStaleExecutionError" })).toBe(false);
  expect(isWorkflowControlFlowSignal(undefined)).toBe(false);
});
