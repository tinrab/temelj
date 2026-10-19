import { createStorage } from "@temelj/storage";
import { describe, expect, test } from "vitest";

import { createWorkflowStore } from "../store/create.ts";
import { createWorkflowEngine } from "./create.ts";

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
