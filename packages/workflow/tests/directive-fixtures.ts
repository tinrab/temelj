import {
  transformWorkflowSource,
  type TransformManifest,
  type TransformOptions,
} from "../src/vite/transform.ts";
import { WorkflowDirectiveFixture, WorkflowDirectiveFixtureResult } from "./schema.ts";

/** Compiles in-memory directive fixtures for transform and plugin tests. */
export function compileWorkflowDirectiveFixtures(
  fixtures: readonly WorkflowDirectiveFixture[],
  options: Omit<TransformOptions, "manifests"> & {
    readonly manifests?: readonly TransformManifest[];
  } = {},
): readonly WorkflowDirectiveFixtureResult[] {
  const manifests: TransformManifest[] = [...(options.manifests ?? [])];

  return fixtures.map((fixture): WorkflowDirectiveFixtureResult => {
    const result = transformWorkflowSource(fixture.code, fixture.id, {
      ...options,
      manifests,
    });

    if (result !== undefined) {
      manifests.push(result.manifest);
    }

    const result1: WorkflowDirectiveFixtureResult = { id: fixture.id };

    if (result !== undefined) {
      Object.assign(result1, { result } satisfies Partial<WorkflowDirectiveFixtureResult>);
    }

    return result1;
  });
}
