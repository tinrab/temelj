import { describe, expect, it } from "vitest";

import { makeGeneratedName } from "../../src/vite/generated-name.ts";
import { transformWorkflowSource } from "../../src/vite/transform.ts";

const CALL_WORKFLOW_STEP_FUNCTION_NAME = makeGeneratedName("callWorkflowStepFunction");
const CONTEXT_NAME = makeGeneratedName("context");
const LOAD_USER_STEP_NAME = makeGeneratedName("step", "loadUser");

function callWorkflowStepFunctionText(fn: string, args: string): string {
  return `${CALL_WORKFLOW_STEP_FUNCTION_NAME}(${CONTEXT_NAME}.step, ${fn}, ${args})`;
}

describe("transformWorkflowSource import manifests", () => {
  it("rewrites imported step calls when the imported module manifest is provided", () => {
    const steps = transformWorkflowSource(
      `
export async function loadUser(userId: string) {
  "use step";
  return { name: userId };
}
`,
      "/repo/workflows/steps.ts",
      { root: "/repo" },
    );
    const result = transformWorkflowSource(
      `
import { loadUser } from "./steps";

export async function welcomeUser(userId: string) {
  "use workflow";
  const user = await loadUser(userId);
  return user.name;
}
`,
      "/repo/workflows/main.ts",
      { root: "/repo", manifests: steps === undefined ? [] : [steps.manifest] },
    );

    expect(result?.code).toContain(
      `const user = await ${callWorkflowStepFunctionText("loadUser", "userId")};`,
    );
    expect(result?.manifest.imports).toEqual([
      {
        source: "workflows/steps.ts",
        importName: "loadUser",
        localName: "loadUser",
        kind: "step",
        workflowName: "workflows/steps.ts:loadUser",
      },
    ]);
  });

  it("rewrites TypeScript step imports that use ESM .js specifiers", () => {
    const steps = transformWorkflowSource(
      `
export async function loadUser(userId: string) {
  "use step";
  return { name: userId };
}
`,
      "/repo/workflows/steps.ts",
      { root: "/repo" },
    );
    const result = transformWorkflowSource(
      `
import { loadUser } from "./steps.js";

export async function welcomeUser(userId: string) {
  "use workflow";
  const user = await loadUser(userId);
  return user.name;
}
`,
      "/repo/workflows/main.ts",
      { root: "/repo", manifests: steps === undefined ? [] : [steps.manifest] },
    );

    expect(result?.code).toContain(
      `const user = await ${callWorkflowStepFunctionText("loadUser", "userId")};`,
    );
    expect(result?.manifest.imports).toEqual([
      {
        source: "workflows/steps.ts",
        importName: "loadUser",
        localName: "loadUser",
        kind: "step",
        workflowName: "workflows/steps.ts:loadUser",
      },
    ]);
  });

  it("rewrites aliased imported step calls when the imported module manifest is provided", () => {
    const steps = transformWorkflowSource(
      `
export async function loadUser(userId: string) {
  "use step";
  return { name: userId };
}
`,
      "/repo/workflows/steps.ts",
      { root: "/repo" },
    );
    const result = transformWorkflowSource(
      `
import { loadUser as readUser } from "./steps.ts";

export async function welcomeUser(userId: string) {
  "use workflow";
  return await readUser(userId);
}
`,
      "/repo/workflows/main.ts",
      { root: "/repo", manifests: steps === undefined ? [] : [steps.manifest] },
    );

    expect(result?.code).toContain(
      `return await ${callWorkflowStepFunctionText("readUser", "userId")};`,
    );
    expect(result?.manifest.imports).toEqual([
      {
        source: "workflows/steps.ts",
        importName: "loadUser",
        localName: "readUser",
        kind: "step",
        workflowName: "workflows/steps.ts:loadUser",
      },
    ]);
  });

  it("rewrites re-exported imported step calls when barrel manifests are provided", () => {
    const steps = transformWorkflowSource(
      `
export async function loadUser(userId: string) {
  "use step";
  return { name: userId };
}
`,
      "/repo/workflows/steps.ts",
      { root: "/repo" },
    );
    const barrel = transformWorkflowSource(
      `
export { loadUser as readUser } from "./steps";
`,
      "/repo/workflows/index.ts",
      { root: "/repo", manifests: steps === undefined ? [] : [steps.manifest] },
    );
    const result = transformWorkflowSource(
      `
import { readUser } from "./index";

export async function welcomeUser(userId: string) {
  "use workflow";
  return await readUser(userId);
}
`,
      "/repo/workflows/main.ts",
      { root: "/repo", manifests: barrel === undefined ? [] : [barrel.manifest] },
    );

    expect(barrel?.code).toBe('export { loadUser as readUser } from "./steps";\n');
    expect(barrel?.manifest.functions).toEqual([
      {
        kind: "step",
        exportName: "readUser",
        localName: "loadUser",
        generatedName: LOAD_USER_STEP_NAME,
        workflowName: "workflows/steps.ts:loadUser",
      },
    ]);
    expect(result?.code).toContain(
      `return await ${callWorkflowStepFunctionText("readUser", "userId")};`,
    );
  });

  it("rewrites export-star imported step calls when barrel manifests are provided", () => {
    const steps = transformWorkflowSource(
      `
export async function loadUser(userId: string) {
  "use step";
  return { name: userId };
}
`,
      "/repo/workflows/steps.ts",
      { root: "/repo" },
    );
    const barrel = transformWorkflowSource(
      `
export * from "./steps";
`,
      "/repo/workflows/index.ts",
      { root: "/repo", manifests: steps === undefined ? [] : [steps.manifest] },
    );
    const result = transformWorkflowSource(
      `
import { loadUser } from "./index";

export async function welcomeUser(userId: string) {
  "use workflow";
  return await loadUser(userId);
}
`,
      "/repo/workflows/main.ts",
      { root: "/repo", manifests: barrel === undefined ? [] : [barrel.manifest] },
    );

    expect(barrel?.manifest.functions).toEqual([
      {
        kind: "step",
        exportName: "loadUser",
        localName: "loadUser",
        generatedName: LOAD_USER_STEP_NAME,
        workflowName: "workflows/steps.ts:loadUser",
      },
    ]);
    expect(result?.code).toContain(
      `return await ${callWorkflowStepFunctionText("loadUser", "userId")};`,
    );
  });
});
