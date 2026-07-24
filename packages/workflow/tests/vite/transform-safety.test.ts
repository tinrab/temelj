import { describe, expect, it } from "vitest";

import { makeGeneratedName } from "../../src/vite/generated-name.ts";
import { transformWorkflowSource, WorkflowTransformError } from "../../src/vite/transform.ts";

const CALL_WORKFLOW_STEP_FUNCTION_NAME = makeGeneratedName("callWorkflowStepFunction");
const CONTEXT_NAME = makeGeneratedName("context");
const LOAD_USER_STEP_NAME = makeGeneratedName("step", "loadUser");

function callWorkflowStepFunctionText(fn: string, args: string): string {
  return `${CALL_WORKFLOW_STEP_FUNCTION_NAME}(${CONTEXT_NAME}.step, ${fn}, ${args})`;
}

describe("transformWorkflowSource safety checks", () => {
  it("rejects namespace imports in directive modules", () => {
    expect(() =>
      transformWorkflowSource(
        `
import * as steps from "./steps";

export async function welcomeUser(userId: string) {
  "use workflow";
  return await steps.loadUser(userId);
}
`,
        "/repo/workflows/main.ts",
        {
          root: "/repo",
          manifests: [
            {
              file: "workflows/steps.ts",
              functions: [
                {
                  kind: "step",
                  exportName: "loadUser",
                  localName: "loadUser",
                  generatedName: LOAD_USER_STEP_NAME,
                  workflowName: "workflows/steps.ts:loadUser",
                },
              ],
              imports: [],
            },
          ],
        },
      ),
    ).toThrow(WorkflowTransformError);
  });

  it("allows namespace imports from modules without workflow manifests", () => {
    const result = transformWorkflowSource(
      `
import { z } from "zod";

export async function welcomeUser(userId: string) {
  "use workflow";
  const parsed = z.string().parse(userId);
  return parsed;
}
`,
      "/repo/workflows/main.ts",
      { root: "/repo" },
    );

    expect(result?.code).toContain('import { z } from "zod";');
    expect(result?.code).toContain("const parsed = z.string().parse(userId);");
  });

  it("rejects obvious nondeterministic globals in workflow directive bodies", () => {
    for (const expression of [
      "new Date()",
      "Date.now()",
      "Math.random()",
      "globalThis.Math.random()",
      "crypto.randomUUID()",
      "globalThis.crypto.getRandomValues(new Uint8Array(8))",
      "performance.now()",
      'fetch("https://example.com")',
      "setTimeout(() => undefined, 1)",
      "globalThis.setInterval(() => undefined, 1)",
      "queueMicrotask(() => undefined)",
      "process.env.NODE_ENV",
      "globalThis.process.env.NODE_ENV",
      "import.meta.env.MODE",
    ]) {
      expect(() =>
        transformWorkflowSource(
          `
export async function nondeterministic() {
  "use workflow";
  return ${expression};
}
`,
          `/repo/workflows/nondeterministic-${expression.length}.ts`,
          { root: "/repo" },
        ),
      ).toThrow(WorkflowTransformError);
    }
  });

  it("rejects Node builtin imports used inside workflow directive bodies", () => {
    for (const [importText, expression] of [
      ['import * as fs from "node:fs";', "fs.readFileSync(path)"],
      ['import crypto from "node:crypto";', "crypto.randomUUID()"],
      ['import { randomUUID as uuid } from "node:crypto";', "uuid()"],
      ['import { readFileSync } from "fs";', "readFileSync(path)"],
    ]) {
      expect(() =>
        transformWorkflowSource(
          `
${importText}

export async function nondeterministic(path: string) {
  "use workflow";
  return ${expression};
}
`,
          `/repo/workflows/node-builtin-${expression.length}.ts`,
          { root: "/repo" },
        ),
      ).toThrow(WorkflowTransformError);
    }
  });

  it("allows Node builtin imports that are not referenced by workflow bodies", () => {
    const result = transformWorkflowSource(
      `
import { readFileSync } from "node:fs";

export async function readConfig(path: string) {
  "use step";
  return readFileSync(path, "utf8");
}

export async function load() {
  "use workflow";
  return await readConfig("config.json");
}
`,
      "/repo/workflows/read-config.ts",
      { root: "/repo" },
    );

    expect(result?.code).toContain('import { readFileSync } from "node:fs";');
    expect(result?.code).toContain(callWorkflowStepFunctionText("readConfig", '"config.json"'));
  });

  it("allows deterministic helper calls in workflow directive bodies", () => {
    const result = transformWorkflowSource(
      `
export async function deterministic() {
  "use workflow";
  const now = await workflow.now("clock");
  const random = await workflow.random("roll");
  return { now, random };
}
`,
      "/repo/workflows/deterministic.ts",
      { root: "/repo" },
    );

    expect(result?.code).toContain('const now = await workflow.now("clock");');
    expect(result?.code).toContain('const random = await workflow.random("roll");');
  });
});
