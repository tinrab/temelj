import { createWorkflowClient } from "@temelj/workflow";

import { greetingWorkflow, workflows } from "./workflows.ts";

const client = createWorkflowClient({ workflows });

try {
  const handle = await client.runs.start(greetingWorkflow, {
    name: process.argv[2] ?? "Ada",
    waitForApproval: false,
  });

  await client.workers.processRun(handle.runId);
  console.log(await handle.result());
} finally {
  await client.close();
}
