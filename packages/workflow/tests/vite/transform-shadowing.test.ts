import { describe, expect, it } from "vitest";

import { makeGeneratedName } from "../../src/vite/generated-name.ts";
import { transformWorkflowSource } from "../../src/vite/transform.ts";

const CALL_WORKFLOW_STEP_FUNCTION_NAME = makeGeneratedName("callWorkflowStepFunction");
const CONTEXT_NAME = makeGeneratedName("context");

function callWorkflowStepFunctionText(fn: string, args: string): string {
  return `${CALL_WORKFLOW_STEP_FUNCTION_NAME}(${CONTEXT_NAME}.step, ${fn}, ${args})`;
}

describe("transformWorkflowSource imported step shadowing", () => {
  it("preserves workflow parameter calls that shadow imported steps", () => {
    const steps = transformWorkflowSource(
      `
export async function sendOne(value: string) {
  "use step";
  return value;
}
`,
      "/repo/workflows/steps.ts",
      { root: "/repo" },
    );
    const result = transformWorkflowSource(
      `
import { sendOne } from "./steps";

export async function process(sendOne: (value: string) => Promise<string>) {
  "use workflow";
  return await sendOne("local");
}
`,
      "/repo/workflows/main.ts",
      { root: "/repo", manifests: steps === undefined ? [] : [steps.manifest] },
    );

    expect(result?.code).toContain('return await sendOne("local");');
    expect(result?.code).not.toContain(callWorkflowStepFunctionText("sendOne", '"local"'));
  });

  it("preserves local bindings that shadow imported steps", () => {
    const steps = transformWorkflowSource(
      `
export async function sendOne(value: string) {
  "use step";
  return value;
}
`,
      "/repo/workflows/steps.ts",
      { root: "/repo" },
    );
    const result = transformWorkflowSource(
      `
import { sendOne } from "./steps";

export async function process(value: string) {
  "use workflow";
  const sendOne = async (input: string) => \`local:\${input}\`;
  return await sendOne(value);
}
`,
      "/repo/workflows/main.ts",
      { root: "/repo", manifests: steps === undefined ? [] : [steps.manifest] },
    );

    expect(result?.code).toContain("return await sendOne(value);");
    expect(result?.code).not.toContain(callWorkflowStepFunctionText("sendOne", "value"));
  });

  it("preserves unbraced switch case bindings that shadow imported steps", () => {
    const steps = transformWorkflowSource(
      `
export async function sendOne(value: string) {
  "use step";
  return value;
}
`,
      "/repo/workflows/steps.ts",
      { root: "/repo" },
    );
    const result = transformWorkflowSource(
      `
import { sendOne } from "./steps";

export async function process(kind: string, value: string) {
  "use workflow";
  let output = value;
  switch (kind) {
    case "local":
      const sendOne = (input: string) => \`local:\${input}\`;
      output = sendOne("local");
      break;
    default:
      output = "remote";
      break;
  }
  return await sendOne(output);
}
`,
      "/repo/workflows/main.ts",
      { root: "/repo", manifests: steps === undefined ? [] : [steps.manifest] },
    );

    expect(result?.code).toContain('output = sendOne("local");');
    expect(result?.code).not.toContain(callWorkflowStepFunctionText("sendOne", '"local"'));
    expect(result?.code).toContain(
      `return await ${callWorkflowStepFunctionText("sendOne", "output")};`,
    );
  });

  it("preserves unbraced switch case bindings that shadow local steps", () => {
    const result = transformWorkflowSource(
      `
export async function sendOne(value: string) {
  "use step";
  return value;
}

export async function process(kind: string) {
  "use workflow";
  let output = "";
  switch (kind) {
    case "local":
      const sendOne = (value: string) => value;
      output = sendOne("a");
      break;
    default:
      output = "remote";
      break;
  }
  return await sendOne(output);
}
`,
      "/repo/workflows/main.ts",
      { root: "/repo" },
    );

    expect(result?.code).toContain('output = sendOne("a");');
    expect(result?.code).not.toContain(callWorkflowStepFunctionText("sendOne", '"a"'));
    expect(result?.code).toContain(
      `return await ${callWorkflowStepFunctionText("sendOne", "output")};`,
    );
  });

  it("preserves local function declarations that shadow imported steps", () => {
    const steps = transformWorkflowSource(
      `
export async function sendOne(value: string) {
  "use step";
  return value;
}
`,
      "/repo/workflows/steps.ts",
      { root: "/repo" },
    );
    const result = transformWorkflowSource(
      `
import { sendOne } from "./steps";

export async function process(value: string) {
  "use workflow";
  async function sendOne(input: string) {
    return \`local:\${input}\`;
  }
  return await sendOne(value);
}
`,
      "/repo/workflows/main.ts",
      { root: "/repo", manifests: steps === undefined ? [] : [steps.manifest] },
    );

    expect(result?.code).toContain("return await sendOne(value);");
    expect(result?.code).not.toContain(callWorkflowStepFunctionText("sendOne", "value"));
  });

  it("preserves destructured local bindings that shadow imported steps", () => {
    const steps = transformWorkflowSource(
      `
export async function sendOne(value: string) {
  "use step";
  return value;
}
`,
      "/repo/workflows/steps.ts",
      { root: "/repo" },
    );
    const result = transformWorkflowSource(
      `
import { sendOne } from "./steps";

export async function process(source: { sendOne: (value: string) => Promise<string> }) {
  "use workflow";
  const { sendOne } = source;
  return await sendOne("local");
}
`,
      "/repo/workflows/main.ts",
      { root: "/repo", manifests: steps === undefined ? [] : [steps.manifest] },
    );

    expect(result?.code).toContain('return await sendOne("local");');
    expect(result?.code).not.toContain(callWorkflowStepFunctionText("sendOne", '"local"'));
  });

  it("preserves nested callback parameters that shadow imported steps", () => {
    const steps = transformWorkflowSource(
      `
export async function sendOne(value: string) {
  "use step";
  return value;
}
`,
      "/repo/workflows/steps.ts",
      { root: "/repo" },
    );
    const result = transformWorkflowSource(
      `
import { sendOne } from "./steps";

export async function process(callbacks: readonly ((value: string) => Promise<string>)[]) {
  "use workflow";
  return await Promise.all(callbacks.map((sendOne) => sendOne("local")));
}
`,
      "/repo/workflows/main.ts",
      { root: "/repo", manifests: steps === undefined ? [] : [steps.manifest] },
    );

    expect(result?.code).toContain('callbacks.map((sendOne) => sendOne("local"))');
    expect(result?.code).not.toContain(callWorkflowStepFunctionText("sendOne", '"local"'));
  });

  it("still rewrites imported step aliases when they are not shadowed", () => {
    const steps = transformWorkflowSource(
      `
export async function sendOne(value: string) {
  "use step";
  return value;
}
`,
      "/repo/workflows/steps.ts",
      { root: "/repo" },
    );
    const result = transformWorkflowSource(
      `
import { sendOne as sendImported } from "./steps";

export async function process(value: string) {
  "use workflow";
  return await sendImported(value);
}
`,
      "/repo/workflows/main.ts",
      { root: "/repo", manifests: steps === undefined ? [] : [steps.manifest] },
    );

    expect(result?.code).toContain(
      `return await ${callWorkflowStepFunctionText("sendImported", "value")};`,
    );
  });
});
