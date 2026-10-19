import {
  transformWorkflowSource,
  type TransformManifest,
  type TransformOptions,
} from "../compiler/transform.ts";
import { DirectiveFixture, DirectiveFixtureResult } from "./types.ts";

/** Compiles in-memory directive fixtures for transform and plugin tests. */
export function compileDirectiveFixtures(
  fixtures: readonly DirectiveFixture[],
  options: Omit<TransformOptions, "manifests"> & {
    readonly manifests?: readonly TransformManifest[];
  } = {},
): readonly DirectiveFixtureResult[] {
  const manifests: TransformManifest[] = [...(options.manifests ?? [])];

  return fixtures.map((fixture): DirectiveFixtureResult => {
    const result = transformWorkflowSource(fixture.code, fixture.id, {
      ...options,
      manifests,
    });

    if (result !== undefined) {
      manifests.push(result.manifest);
    }

    return {
      id: fixture.id,
      result,
    };
  });
}
