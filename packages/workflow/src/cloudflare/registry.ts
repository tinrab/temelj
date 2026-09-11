import type { WorkflowImplementation, RegistryLike } from "../types/definition.ts";

export function resolveCloudflareWorkflowImplementation(
  registry: RegistryLike,
  name: string,
  version?: string,
): WorkflowImplementation<unknown, unknown> {
  const implementation = registry.getByName(name, version);

  if (implementation === undefined) {
    throw new TypeError(
      `Cloudflare Workflow implementation is not registered: ${
        version === undefined ? name : `${name}@${version}`
      }`,
    );
  }

  return implementation;
}
