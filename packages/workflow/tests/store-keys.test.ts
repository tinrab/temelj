import { describe, expect, test } from "vitest";

import {
  makeEventsKey,
  makeWorkflowIdempotencyKey,
  makeMessageIdempotencyKey,
  makeStepAttemptKey,
  makeRunKey,
} from "../src/store-keys.ts";

describe("workflow store keys", () => {
  test("formats namespaced workflow storage keys", () => {
    expect(makeRunKey("default", "run_1")).toBe("workflow:default:run:run_1");
    expect(makeEventsKey("default", "run_1")).toBe("workflow:default:events:run_1");
    expect(makeStepAttemptKey("default", "run_1", "run:fetch:1")).toBe(
      "workflow:default:step-attempt:run_1:run%3Afetch%3A1",
    );
    expect(
      makeWorkflowIdempotencyKey("default", {
        workflowName: "send/email",
        workflowVersion: "v 1",
        idempotencyKey: "user@example.com",
      }),
    ).toBe("workflow:default:idempotency:send%2Femail%40v%201:user%40example.com");
    expect(makeMessageIdempotencyKey("default", "run/1", "messageId:1")).toBe(
      "workflow:default:message-idempotency:run%2F1:messageId%3A1",
    );
  });
});
