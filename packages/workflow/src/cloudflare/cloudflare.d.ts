declare module "cloudflare:workers" {
  export abstract class WorkflowEntrypoint<TEnv = unknown, TPayload = unknown> {
    protected readonly env: TEnv;
    abstract run(event: unknown, step: unknown): Promise<unknown>;
  }
}

declare module "cloudflare:workflows" {
  export class NonRetryableError extends Error {
    constructor(message: string, name?: string);
  }
}
