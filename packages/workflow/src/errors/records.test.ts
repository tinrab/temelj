import { describe, expect, test } from "vitest";

import { serializeError } from "../engine/serialization.ts";
import { WorkflowErrorCode } from "./codes.ts";
import { WorkflowRetryableError } from "./failures.ts";
import { matchesWorkflowError, workflowErrorFromRecord } from "./records.ts";

describe("matchesWorkflowError", () => {
  const error = new WorkflowRetryableError("Workflow lock is already held: invoice:1", {
    code: WorkflowErrorCode.LOCK_ALREADY_HELD,
    details: { key: "invoice:1" },
  });

  test("matches live errors and stored records by code and details", () => {
    const record = serializeError(error);

    for (const cause of [error, record, workflowErrorFromRecord(record)]) {
      expect(matchesWorkflowError(cause, WorkflowErrorCode.LOCK_ALREADY_HELD)).toBe(true);
      expect(
        matchesWorkflowError(cause, WorkflowErrorCode.LOCK_ALREADY_HELD, { key: "invoice:1" }),
      ).toBe(true);
      expect(
        matchesWorkflowError(cause, WorkflowErrorCode.LOCK_ALREADY_HELD, { key: "invoice:2" }),
      ).toBe(false);
      expect(matchesWorkflowError(cause, WorkflowErrorCode.STREAM_NOT_FOUND)).toBe(false);
    }
  });

  test("treats undefined detail values as wildcards", () => {
    expect(
      matchesWorkflowError(error, WorkflowErrorCode.LOCK_ALREADY_HELD, { key: undefined }),
    ).toBe(true);
  });

  test("does not match values that are not workflow errors", () => {
    for (const cause of [undefined, null, "lock.already_held", new Error("held"), { code: 1 }]) {
      expect(matchesWorkflowError(cause, WorkflowErrorCode.LOCK_ALREADY_HELD)).toBe(false);
    }
  });
});
