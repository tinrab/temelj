import type { RunId, WorkflowRunRecord } from "../../types/run.ts";
import type { WorkflowRunWorkflowSummary } from "../../types/summary.ts";

interface WorkflowRunWorkflowCountAccumulator {
  readonly name: string;
  readonly version?: string;
  count: number;
  readonly runIds: RunId[];
}

type WorkflowRunWorkflowAccumulator = Map<string, WorkflowRunWorkflowCountAccumulator>;

export function createWorkflowRunWorkflowSummaryReducer(): {
  readonly addRun: (run: WorkflowRunRecord) => void;
  readonly finish: () => WorkflowRunWorkflowSummary;
} {
  const workflow = createWorkflowRunWorkflowAccumulator();

  return {
    addRun(run) {
      addWorkflowRunWorkflow(workflow, run);
    },
    finish() {
      return finishWorkflowRunWorkflowSummary(workflow);
    },
  };
}

function createWorkflowRunWorkflowAccumulator(): WorkflowRunWorkflowAccumulator {
  return new Map<string, WorkflowRunWorkflowCountAccumulator>();
}

function addWorkflowRunWorkflow(
  workflow: WorkflowRunWorkflowAccumulator,
  run: WorkflowRunRecord,
): void {
  if (run.workflowName === undefined) {
    return;
  }
  const version = run.workflowVersion;
  const key = version === undefined ? run.workflowName : `${run.workflowName}\0${version}`;
  const current = workflow.get(key);
  if (current !== undefined) {
    current.count++;
    current.runIds.push(run.id);
    return;
  }
  workflow.set(key, {
    name: run.workflowName,
    ...(version === undefined ? {} : { version }),
    count: 1,
    runIds: [run.id],
  });
}

function finishWorkflowRunWorkflowSummary(
  workflow: WorkflowRunWorkflowAccumulator,
): WorkflowRunWorkflowSummary {
  return {
    total: workflow.size,
    workflows: [...workflow.values()]
      .map((entry) => ({ ...entry, runIds: [...entry.runIds].sort() }))
      .sort((left, right) => {
        const nameComparison = left.name.localeCompare(right.name);
        if (nameComparison !== 0) {
          return nameComparison;
        }
        return (left.version ?? "").localeCompare(right.version ?? "");
      }),
  };
}
