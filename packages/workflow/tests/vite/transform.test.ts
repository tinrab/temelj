import { describe, expect, it } from "vitest";

import { makeGeneratedName } from "../../src/vite/generated-name.ts";
import { transformWorkflowSource, WorkflowTransformError } from "../../src/vite/transform.ts";

const DEFINE_WORKFLOW_NAME = makeGeneratedName("implementWorkflow");
const DEFINE_WORKFLOW_STEP_NAME = makeGeneratedName("defineWorkflowStep");
const ATTACH_WORKFLOW_DEFINITION_NAME = makeGeneratedName("attachWorkflowDefinition");
const ATTACH_WORKFLOW_STEP_DEFINITION_NAME = makeGeneratedName("attachWorkflowStepDefinition");
const CALL_WORKFLOW_STEP_FUNCTION_NAME = makeGeneratedName("callWorkflowStepFunction");
const CONTEXT_NAME = makeGeneratedName("context");
const LOAD_USER_STEP_NAME = makeGeneratedName("step", "loadUser");

function callWorkflowStepFunctionText(fn: string, args: string): string {
  return `${CALL_WORKFLOW_STEP_FUNCTION_NAME}(${CONTEXT_NAME}.step, ${fn}, ${args})`;
}

describe("transformWorkflowSource", () => {
  it("returns undefined for files without workflow directives", () => {
    expect(transformWorkflowSource("export const value = 1;", "/repo/src/workflows.ts")).toBe(
      undefined,
    );
  });

  it("emits metadata and runtime attachments for workflow and step functions", () => {
    const result = transformWorkflowSource(
      `
export async function loadUser(userId: string) {
  "use step";
  return { name: userId };
}

export async function welcomeUser(userId: string) {
  "use workflow";
  const user = await loadUser(userId);
  return user.name;
}
`,
      "/repo/src/workflows.ts",
      { root: "/repo" },
    );

    expect(result?.metadata).toEqual({
      file: "src/workflows.ts",
      entries: [
        {
          kind: "step",
          name: "loadUser",
          generatedName: LOAD_USER_STEP_NAME,
          workflowName: "src/workflows.ts:loadUser",
        },
        {
          kind: "workflow",
          name: "welcomeUser",
          generatedName: makeGeneratedName("workflow", "welcomeUser"),
          workflowName: "src/workflows.ts:welcomeUser",
        },
      ],
    });
    expect(result?.manifest).toEqual({
      file: "src/workflows.ts",
      functions: [
        {
          kind: "step",
          exportName: "loadUser",
          localName: "loadUser",
          generatedName: LOAD_USER_STEP_NAME,
          workflowName: "src/workflows.ts:loadUser",
        },
        {
          kind: "workflow",
          exportName: "welcomeUser",
          localName: "welcomeUser",
          generatedName: makeGeneratedName("workflow", "welcomeUser"),
          workflowName: "src/workflows.ts:welcomeUser",
        },
      ],
      imports: [],
    });
    expect(result?.code).toContain('from "@temelj/workflow"');
    expect(result?.code).toContain(DEFINE_WORKFLOW_STEP_NAME);
    expect(result?.code).toContain(`${ATTACH_WORKFLOW_STEP_DEFINITION_NAME}(loadUser`);
    expect(result?.code).toContain(DEFINE_WORKFLOW_NAME);
    expect(result?.code).toContain(`${ATTACH_WORKFLOW_DEFINITION_NAME}(welcomeUser`);
    expect(result?.code).not.toContain('"use workflow"');
    expect(result?.code).not.toContain('"use step"');
  });

  it("uses a configured runtime import specifier", () => {
    const result = transformWorkflowSource(
      `
export async function task() {
  "use workflow";
}
`,
      "/repo/src/task.ts",
      { runtimeImport: "@acme/workflow/runtime" },
    );

    expect(result?.code).toContain('from "@acme/workflow/runtime"');
    expect(result?.code).not.toContain('from "@temelj/workflow"');
  });

  it("emits a source map when configured", () => {
    const code = `
export async function task() {
  "use workflow";
  return "ok";
}
`;
    const result = transformWorkflowSource(code, "/repo/src/task.ts", {
      root: "/repo",
      sourcemap: true,
    });

    expect(result?.map).toMatchObject({
      version: 3,
      file: "/repo/src/task.ts",
      sources: ["/repo/src/task.ts"],
      sourcesContent: [code],
      names: [],
    });
    expect((result?.map as { readonly mappings?: unknown } | undefined)?.mappings).toEqual(
      expect.any(String),
    );
  });

  it("omits source maps by default", () => {
    const result = transformWorkflowSource(
      `
export async function task() {
  "use workflow";
}
`,
      "/repo/src/task.ts",
    );

    expect(result?.map).toBeUndefined();
  });

  it("rewrites direct workflow calls through the compiled function step helper", () => {
    const result = transformWorkflowSource(
      `
async function addOne(value: number) {
  "use step";
  return value + 1;
}

export async function calculate(value: number) {
  "use workflow";
  return await addOne(value);
}
`,
      "/repo/workflows/calculate.ts",
      { root: "/repo" },
    );

    expect(result?.code).toContain(
      `return await ${callWorkflowStepFunctionText("addOne", "value")};`,
    );
  });

  it("preserves unawaited direct helper calls in workflow bodies", () => {
    const result = transformWorkflowSource(
      `
function normalize(value: string) {
  return value.trim();
}

async function saveValue(value: string) {
  "use step";
  return value;
}

export async function processValue(value: string) {
  "use workflow";
  const normalized = normalize(value);
  return await saveValue(normalized);
}
`,
      "/repo/workflows/process-value.ts",
      { root: "/repo" },
    );

    expect(result?.code).toContain("const normalized = normalize(value);");
    expect(result?.code).toContain(
      `return await ${callWorkflowStepFunctionText("saveValue", "normalized")};`,
    );
  });

  it("preserves awaited direct helper calls that are not known steps", () => {
    const result = transformWorkflowSource(
      `
async function normalize(value: string) {
  return value.trim();
}

async function saveValue(value: string) {
  "use step";
  return value;
}

export async function processValue(value: string) {
  "use workflow";
  const normalized = await normalize(value);
  return await saveValue(normalized);
}
`,
      "/repo/workflows/process-value.ts",
      { root: "/repo" },
    );

    expect(result?.code).toContain("const normalized = await normalize(value);");
    expect(result?.code).toContain(
      `return await ${callWorkflowStepFunctionText("saveValue", "normalized")};`,
    );
  });

  it("rewrites local step calls used inside parallel workflow expressions", () => {
    const result = transformWorkflowSource(
      `
async function sendEmail(value: string) {
  "use step";
  return { channel: "email", value };
}

async function sendSms(value: string) {
  "use step";
  return { channel: "sms", value };
}

export async function fanOut(value: string) {
  "use workflow";
  return await Promise.allSettled([
    sendEmail(value),
    sendSms(value),
  ]);
}
`,
      "/repo/workflows/fan-out.ts",
      { root: "/repo" },
    );

    expect(result?.code).toContain(callWorkflowStepFunctionText("sendEmail", "value"));
    expect(result?.code).toContain(callWorkflowStepFunctionText("sendSms", "value"));
  });

  it("rewrites known step calls used inside array maps and Promise.race", () => {
    const result = transformWorkflowSource(
      `
async function sendOne(value: string) {
  "use step";
  return value;
}

export async function raceAndMap(values: readonly string[]) {
  "use workflow";
  const mapped = await Promise.all(values.map((value) => sendOne(value)));
  const fastest = await Promise.race([
    sendOne("first"),
    sendOne("second"),
  ]);
  return { mapped, fastest };
}
`,
      "/repo/workflows/race-and-map.ts",
      { root: "/repo" },
    );

    expect(result?.code).toContain(
      `values.map((value) => ${callWorkflowStepFunctionText("sendOne", "value")})`,
    );
    expect(result?.code).toContain(callWorkflowStepFunctionText("sendOne", '"first"'));
    expect(result?.code).toContain(callWorkflowStepFunctionText("sendOne", '"second"'));
  });

  it("uses configured workflow names and versions", () => {
    const result = transformWorkflowSource(
      `
export async function syncUser(id: string) {
  "use workflow";
  return id;
}
`,
      "/repo/workflows/sync-user.ts",
      {
        root: "/repo",
        name: (file, exportName, kind) => `${kind}:${file}:${exportName}`,
        version: "v1",
      },
    );

    expect(result?.metadata.entries[0]).toEqual({
      kind: "workflow",
      name: "syncUser",
      generatedName: makeGeneratedName("workflow", "syncUser"),
      workflowName: "workflow:workflows/sync-user.ts:syncUser",
      version: "v1",
    });
    expect(result?.code).toContain(
      `${DEFINE_WORKFLOW_NAME}({ name: "workflow:workflows/sync-user.ts:syncUser", version: "v1" }`,
    );
  });

  it("rejects nested directive functions", () => {
    expect(() =>
      transformWorkflowSource(
        `
export async function outer() {
  function inner() {
    "use step";
    return 1;
  }
  return inner();
}
`,
        "/repo/workflows/nested.ts",
        { root: "/repo" },
      ),
    ).toThrow(WorkflowTransformError);
  });
});
