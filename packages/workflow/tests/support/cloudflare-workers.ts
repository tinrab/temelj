export abstract class WorkflowEntrypoint<TEnv = unknown> {
  protected readonly env: TEnv;

  constructor(env: TEnv) {
    this.env = env;
  }

  abstract run(event: unknown, step: unknown): Promise<unknown>;
}
