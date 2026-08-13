import { createWorkflowRuntime } from "@temelj/workflow";

import { greetingWorkflow, workflows } from "./workflows.ts";

const runtime = createWorkflowRuntime({ workflows });

try {
  const handle = await runtime.start(greetingWorkflow.definition, {
    name: process.argv[2] ?? "Ada",
    waitForApproval: false,
  });
  await runtime.workers.processRun(handle.runId);
  console.log(await handle.result());
} finally {
  await runtime.close();
}
