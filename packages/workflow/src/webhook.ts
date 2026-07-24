import type { ParsedWorkflowWebhookToken, ResumeWebhookOptions } from "./types/hook.ts";

import { parseWebhookToken as parseHookWebhookToken } from "./types/hook.ts";

/** Minimal grouped hook facade required by the webhook resume helper. */
export interface WebhookResumer {
  /** Grouped external resume hook operations. */
  readonly hooks: {
    /** Completes a pending webhook-labeled external resume hook. */
    resumeWebhook(token: string, options?: ResumeWebhookOptions): Promise<void>;
  };
}

/** Parses a workflow webhook resume token without resuming the hook. */
export function parseWebhookToken(token: string): ParsedWorkflowWebhookToken {
  const webhook = parseHookWebhookToken(token);
  return {
    runId: webhook.runId,
    name: webhook.name,
    messageId: webhook.messageId,
  };
}

/** Resumes a workflow webhook through a compatible webhook resumer. */
export async function resumeWebhook(
  resumer: WebhookResumer,
  token: string,
  options: ResumeWebhookOptions = {},
): Promise<void> {
  await resumer.hooks.resumeWebhook(token, options);
}
