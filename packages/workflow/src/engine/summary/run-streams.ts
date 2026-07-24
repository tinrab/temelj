import type { RunId } from "../../types/run.ts";
import type { WorkflowRunStreamSummary } from "../../types/summary.ts";
import type { ActiveWorkflowStreamSummary } from "./active-events.ts";

import { earliestOptionalTimestamp } from "../../temporal.ts";

interface WorkflowRunStreamActivitySummary {
  readonly stream?: WorkflowRunStreamSummary;
}

interface WorkflowRunStreamActivityAccumulator {
  chunkCount: number;
  oldestStartedAt?: Temporal.Instant;
  total: number;
  readonly runIds: Set<string>;
  readonly stepIds: Set<string>;
  readonly streamIds: Set<string>;
  readonly streamNames: Set<string>;
}

export function createWorkflowRunStreamActivitySummaryReducer(): {
  readonly addStream: (runId: RunId, stream: ActiveWorkflowStreamSummary) => void;
  readonly finish: () => WorkflowRunStreamActivitySummary;
} {
  const streams = createWorkflowRunStreamActivityAccumulator();

  return {
    addStream(runId, stream) {
      addWorkflowRunStreamActivity(streams, runId, stream);
    },
    finish() {
      return finishWorkflowRunStreamActivitySummary(streams);
    },
  };
}

function createWorkflowRunStreamActivityAccumulator(): WorkflowRunStreamActivityAccumulator {
  return {
    chunkCount: 0,
    total: 0,
    runIds: new Set<string>(),
    stepIds: new Set<string>(),
    streamIds: new Set<string>(),
    streamNames: new Set<string>(),
  };
}

function addWorkflowRunStreamActivity(
  streams: WorkflowRunStreamActivityAccumulator,
  runId: RunId,
  stream: ActiveWorkflowStreamSummary,
): void {
  streams.total++;
  streams.runIds.add(runId);
  streams.stepIds.add(stream.stepId);
  streams.streamIds.add(stream.streamId);
  streams.streamNames.add(stream.stepName);
  streams.chunkCount += stream.chunkCount;
  streams.oldestStartedAt = earliestOptionalTimestamp(streams.oldestStartedAt, stream.startedAt);
}

function finishWorkflowRunStreamActivitySummary(
  streams: WorkflowRunStreamActivityAccumulator,
): WorkflowRunStreamActivitySummary {
  return streams.total === 0
    ? {}
    : {
        stream: {
          activeStreams: streams.total,
          activeStreamRuns: streams.runIds.size,
          streamRunIds: [...streams.runIds].sort(),
          streamStepIds: [...streams.stepIds].sort(),
          streamIds: [...streams.streamIds].sort(),
          streamNames: [...streams.streamNames].sort(),
          chunkCount: streams.chunkCount,
          ...(streams.oldestStartedAt === undefined
            ? {}
            : { oldestStartedAt: streams.oldestStartedAt }),
        },
      };
}
