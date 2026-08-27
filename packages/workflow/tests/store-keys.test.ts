import { describe, expect, test } from "vitest";

import {
  isStepAttemptKey,
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
        idempotencyKey: "user@rabzelj.com",
      }),
    ).toBe("workflow:default:idempotency:send%2Femail%40v%201:user%40rabzelj.com");
    expect(makeMessageIdempotencyKey("default", "run/1", "messageId:1")).toBe(
      "workflow:default:message-idempotency:run%2F1:messageId%3A1",
    );
  });

  test("identifies canonical step-attempt storage keys", () => {
    expect(
      isStepAttemptKey(
        makeStepAttemptKey("default", "run_1", "run:fetch:details:1"),
        "default",
        "run_1",
      ),
    ).toBe(true);
    expect(
      isStepAttemptKey(
        makeStepAttemptKey("default", "run_1", "run:fetch:not-an-attempt"),
        "default",
        "run_1",
      ),
    ).toBe(false);
    expect(
      isStepAttemptKey(makeStepAttemptKey("other", "run_1", "run:fetch:1"), "default", "run_1"),
    ).toBe(false);
    expect(
      isStepAttemptKey("workflow:default:step-attempt:run_1:%E0%A4%A", "default", "run_1"),
    ).toBe(false);
  });
});
