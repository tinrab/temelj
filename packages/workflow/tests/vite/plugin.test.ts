import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { build } from "vite";
import { describe, expect, it } from "vitest";

import { makeGeneratedName } from "../../src/vite/generated-name.ts";
import { workflow } from "../../src/vite/plugin.ts";

const ATTACH_WORKFLOW_DEFINITION_NAME = makeGeneratedName("attachWorkflowDefinition");

const CALL_WORKFLOW_STEP_FUNCTION_NAME = makeGeneratedName("callWorkflowStepFunction");

const CONTEXT_NAME = makeGeneratedName("context");

interface ViteWorkflowFixture {
  readonly source: string;
  readonly modules?: ReadonlyMap<string, string>;
  readonly exclude?: readonly string[];
}

async function buildWorkflowFixture(fixture: ViteWorkflowFixture): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "temelj-workflow-vite-"));

  try {
    await fs.writeFile(path.join(root, "workflow.ts"), fixture.source);

    for (const [file, source] of fixture.modules ?? []) {
      await fs.writeFile(path.join(root, file), source);
    }

    let transformed = "";

    await build({
      configFile: false,
      root,
      logLevel: "silent",
      plugins: [
        workflow({ root, exclude: fixture.exclude }),
        {
          name: "capture-workflow-transform",
          enforce: "pre",
          transform(code, id) {
            if (id === path.join(root, "workflow.ts")) {
              transformed = code;
            }
          },
        },
      ],
      build: {
        write: false,
        minify: false,
        lib: { entry: path.join(root, "workflow.ts"), formats: ["es"] },
        rolldownOptions: { external: ["@temelj/workflow"] },
      },
    });

    return transformed;
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe("workflow Vite plugin", () => {
  it("compiles workflows through Vite's native transform context", async () => {
    const code = await buildWorkflowFixture({
      source: `
export async function task(value: string) {
  "use workflow";
  return value;
}
`,
    });

    expect(code).toContain(`${ATTACH_WORKFLOW_DEFINITION_NAME}(task`);
  });

  it.each([
    { name: "direct", source: "./steps", importName: "loadUser", reExport: "" },
    {
      name: "renamed re-export",
      source: "./index",
      importName: "readUser",
      reExport: 'export { loadUser as readUser } from "./steps";',
    },
    {
      name: "export-star",
      source: "./index",
      importName: "loadUser",
      reExport: 'export * from "./steps";',
    },
  ])("loads $name step manifests before transforming importers", async (fixture) => {
    const code = await buildWorkflowFixture({
      modules: new Map([
        [
          "steps.ts",
          `
export async function loadUser(userId: string) {
  "use step";
  return { name: userId };
}
`,
        ],
        ["index.ts", fixture.reExport],
      ]),
      source: `
import { ${fixture.importName} } from "${fixture.source}";

export async function welcomeUser(userId: string) {
  "use workflow";
  const user = await ${fixture.importName}(userId);
  return user.name;
}
`,
    });

    expect(code).toContain(
      `${CALL_WORKFLOW_STEP_FUNCTION_NAME}(${CONTEXT_NAME}.step, ${fixture.importName}, userId)`,
    );
  });

  it("respects exclusions in the native transform hook", async () => {
    const code = await buildWorkflowFixture({
      source: 'export function task() { "use workflow"; return 1; }',
      exclude: ["workflow\\.ts$"],
    });

    expect(code).not.toContain(ATTACH_WORKFLOW_DEFINITION_NAME);
  });
});
