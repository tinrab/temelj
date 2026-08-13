import { defineWorkflowBundle, implementWorkflow } from "@temelj/workflow";

export interface GreetingInput {
  readonly name: string;
  readonly waitForApproval: boolean;
}

export interface GreetingResult {
  readonly approved: boolean;
  readonly executionId: string;
  readonly message: string;
}

export const greetingWorkflow = implementWorkflow<GreetingInput, GreetingResult>(
  { name: "cloudflare-greeting" },
  async ({ input, step }) => {
    const approved = input.waitForApproval
      ? await step.message.wait<boolean>({
          messageId: "approval",
          timeout: Temporal.Duration.from({ minutes: 5 }),
        })
      : true;
    const message = await step.task.run({ name: "create-greeting" }, () => {
      return `Hello, ${input.name}!`;
    });
    const executionId = await step.deterministic.uuid("execution-id");
    return { approved, executionId, message };
  },
);

export const workflows = defineWorkflowBundle([greetingWorkflow]);
