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
  return fixtures.map((fixture) => {
    const result = transformWorkflowSource(fixture.code, fixture.id, {
      ...options,
      manifests,
    });
    if (result !== undefined) {
      manifests.push(result.manifest);
    }
    return { id: fixture.id, ...(result === undefined ? {} : { result }) };
  });
}
