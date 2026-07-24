import { createStorage } from "@temelj/storage";
import { describe, expect, test } from "vitest";

import { createWorkflowEngine } from "../../src/engine/create.ts";
import { createWorkflowStore } from "../../src/store/create.ts";

describe("workflow validation", () => {
  test("rejects mutually exclusive workflow constructor options", () => {
    expect(() =>
      createWorkflowEngine({
        store: createWorkflowStore(),
        storage: createStorage(),
      }),
    ).toThrow("Workflow engine options cannot include both store and storage");
  });
});
