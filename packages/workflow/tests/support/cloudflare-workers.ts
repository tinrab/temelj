import type { ExecutionContext } from "@cloudflare/workers-types";

import type {
  CloudflareWorkflowEvent,
  CloudflareWorkflowStep,
} from "../../src/cloudflare/types.ts";

export abstract class WorkflowEntrypoint<TEnv = unknown> {
  protected readonly env: TEnv;

  constructor(_context: ExecutionContext, env: TEnv) {
    this.env = env;
  }

  abstract run(event: CloudflareWorkflowEvent, step: CloudflareWorkflowStep): Promise<string>;
}
