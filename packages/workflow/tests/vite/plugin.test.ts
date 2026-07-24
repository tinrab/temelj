import { describe, expect, it } from "vitest";

import { makeGeneratedName } from "../../src/vite/generated-name.ts";
import { workflow } from "../../src/vite/plugin.ts";

const ATTACH_WORKFLOW_DEFINITION_NAME = makeGeneratedName("attachWorkflowDefinition");
const CALL_WORKFLOW_STEP_FUNCTION_NAME = makeGeneratedName("callWorkflowStepFunction");
const CONTEXT_NAME = makeGeneratedName("context");

function callWorkflowStepFunctionText(fn: string, args: string): string {
  return `${CALL_WORKFLOW_STEP_FUNCTION_NAME}(${CONTEXT_NAME}.step, ${fn}, ${args})`;
}

describe("workflow Vite plugin", () => {
  it("delegates Vite transform calls to the shared workflow transform", async () => {
    const plugin = workflow({ root: "/repo" });
    if (typeof plugin.transform !== "function") {
      throw new Error("Expected workflow plugin to provide a transform hook");
    }

    const result = await plugin.transform.call(
      {} as ThisParameterType<typeof plugin.transform>,
      `
export async function task(value: string) {
  "use workflow";
  return value;
}
`,
      "/repo/src/task.ts",
    );

    expect(result).toEqual(
      expect.objectContaining({
        code: expect.stringContaining(`${ATTACH_WORKFLOW_DEFINITION_NAME}(task`),
      }),
    );
    expect(result).not.toHaveProperty("map");
  });

  it("loads imported step manifests before transforming workflow importers", async () => {
    const plugin = workflow({ root: "/repo" });
    const transform = plugin.transform;
    if (typeof transform !== "function") {
      throw new Error("Expected workflow plugin to provide a transform hook");
    }

    const modules = new Map([
      [
        "/repo/src/steps.ts",
        `
export async function loadUser(userId: string) {
  "use step";
  return { name: userId };
}
`,
      ],
    ]);
    const context = {
      async resolve(source: string, importer: string | undefined) {
        if (source === "./steps" && importer === "/repo/src/workflow.ts") {
          return { id: "/repo/src/steps.ts" };
        }
        return null;
      },
      async load(options: { readonly id: string }) {
        const code = modules.get(options.id);
        if (code === undefined) {
          return null;
        }
        return await transform.call(context as never, code, options.id);
      },
    };

    const result = await transform.call(
      context as ThisParameterType<typeof transform>,
      `
import { loadUser } from "./steps";

export async function welcomeUser(userId: string) {
  "use workflow";
  const user = await loadUser(userId);
  return user.name;
}
`,
      "/repo/src/workflow.ts",
    );

    expect(result).toEqual(
      expect.objectContaining({
        code: expect.stringContaining(
          `const user = await ${callWorkflowStepFunctionText("loadUser", "userId")};`,
        ),
      }),
    );
  });

  it("loads re-exported step manifests before transforming workflow importers", async () => {
    const plugin = workflow({ root: "/repo" });
    const transform = plugin.transform;
    if (typeof transform !== "function") {
      throw new Error("Expected workflow plugin to provide a transform hook");
    }

    const modules = new Map([
      [
        "/repo/src/steps.ts",
        `
export async function loadUser(userId: string) {
  "use step";
  return { name: userId };
}
`,
      ],
      [
        "/repo/src/index.ts",
        `
export { loadUser as readUser } from "./steps";
`,
      ],
    ]);
    const context = {
      async resolve(source: string, importer: string | undefined) {
        if (source === "./index" && importer === "/repo/src/workflow.ts") {
          return { id: "/repo/src/index.ts" };
        }
        if (source === "./steps" && importer === "/repo/src/index.ts") {
          return { id: "/repo/src/steps.ts" };
        }
        return null;
      },
      async load(options: { readonly id: string }) {
        const code = modules.get(options.id);
        if (code === undefined) {
          return null;
        }
        return await transform.call(context as never, code, options.id);
      },
    };

    const result = await transform.call(
      context as ThisParameterType<typeof transform>,
      `
import { readUser } from "./index";

export async function welcomeUser(userId: string) {
  "use workflow";
  const user = await readUser(userId);
  return user.name;
}
`,
      "/repo/src/workflow.ts",
    );

    expect(result).toEqual(
      expect.objectContaining({
        code: expect.stringContaining(
          `const user = await ${callWorkflowStepFunctionText("readUser", "userId")};`,
        ),
      }),
    );
  });

  it("loads export-star step manifests before transforming workflow importers", async () => {
    const plugin = workflow({ root: "/repo" });
    const transform = plugin.transform;
    if (typeof transform !== "function") {
      throw new Error("Expected workflow plugin to provide a transform hook");
    }

    const modules = new Map([
      [
        "/repo/src/steps.ts",
        `
export async function loadUser(userId: string) {
  "use step";
  return { name: userId };
}
`,
      ],
      [
        "/repo/src/index.ts",
        `
export * from "./steps";
`,
      ],
    ]);
    const context = {
      async resolve(source: string, importer: string | undefined) {
        if (source === "./index" && importer === "/repo/src/workflow.ts") {
          return { id: "/repo/src/index.ts" };
        }
        if (source === "./steps" && importer === "/repo/src/index.ts") {
          return { id: "/repo/src/steps.ts" };
        }
        return null;
      },
      async load(options: { readonly id: string }) {
        const code = modules.get(options.id);
        if (code === undefined) {
          return null;
        }
        return await transform.call(context as never, code, options.id);
      },
    };

    const result = await transform.call(
      context as ThisParameterType<typeof transform>,
      `
import { loadUser } from "./index";

export async function welcomeUser(userId: string) {
  "use workflow";
  const user = await loadUser(userId);
  return user.name;
}
`,
      "/repo/src/workflow.ts",
    );

    expect(result).toEqual(
      expect.objectContaining({
        code: expect.stringContaining(
          `const user = await ${callWorkflowStepFunctionText("loadUser", "userId")};`,
        ),
      }),
    );
  });
});
