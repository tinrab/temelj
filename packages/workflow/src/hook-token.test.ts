import type { StorageValue } from "@temelj/storage";

import { describe, expect, test } from "vitest";

import { WorkflowErrorCode } from "./errors/codes.ts";
import { parseHookToken } from "./hook-token.ts";

function token(payload: Readonly<Record<string, StorageValue>>, version = "v1"): string {
  return `temelj-hook:${version}:${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}

const payload = { runId: "run_1", name: "approval", messageId: "approved", kind: "webhook" };

describe("parseHookToken", () => {
  test("decodes the run, message, and kind a token resumes", () => {
    expect(parseHookToken(token({ ...payload, metadata: { route: "/approve" } }))).toEqual({
      ...payload,
      metadata: { route: "/approve" },
    });
  });

  test.each([
    ["a missing kind", token({ runId: "run_1", name: "approval", messageId: "approved" })],
    ["an unknown kind", token({ ...payload, kind: "callback" })],
    ["another version", token(payload, "v2")],
    ["another prefix", token(payload).replace("temelj-hook:", "other-hook:")],
    ["a body that is not JSON", "temelj-hook:v1:not-json"],
  ])("rejects tokens with %s", (_case, value) => {
    expect(() => parseHookToken(value)).toThrow(
      expect.objectContaining({ code: WorkflowErrorCode.HOOK_TOKEN_INVALID }),
    );
  });
});
