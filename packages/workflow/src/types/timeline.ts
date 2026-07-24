import type { StorageValue } from "@temelj/storage";

import type { WorkflowErrorRecord } from "./error.ts";
import type {
  AttributesSetEvent,
  ChildWorkflowCompletedEvent,
  ChildWorkflowFailedEvent,
  ChildWorkflowStartedEvent,
  DeterministicValueRecordedEvent,
  MetadataSetEvent,
  MessageSendCompletedEvent,
  MessageSendFailedEvent,
  MessageSendStartedEvent,
  MessageSentEvent,
  MessageWaitCompletedEvent,
  MessageWaitFailedEvent,
  MessageWaitStartedEvent,
  SleepCompletedEvent,
  SleepStartedEvent,
  WorkflowStepCompletedEvent,
  WorkflowStepFailedEvent,
  WorkflowStepStartedEvent,
  StreamChunkEvent,
  StreamClosedEvent,
  StreamFailedEvent,
  StreamStartedEvent,
  EventRecord,
} from "./events.ts";
import type { MessageId } from "./message-id.ts";
import type { RunId, WorkflowAttributePatch, WorkflowRunRecord } from "./run.ts";
import type { StepId } from "./step-id.ts";
import type { StreamId } from "./stream-id.ts";

type WorkflowStartedEvent = Extract<EventRecord, { readonly kind: "workflow_started" }>;
type WorkflowCompletedEvent = Extract<EventRecord, { readonly kind: "workflow_completed" }>;
type WorkflowFailedEvent = Extract<EventRecord, { readonly kind: "workflow_failed" }>;

/** Describes the workflow timeline contract. */
export interface Timeline {
  readonly run: WorkflowRunRecord;
  readonly entries: readonly TimelineEntryRecord[];
}

/** Kind values for workflow timeline entries. */
export type TimelineEntryKind =
  | "workflow"
  | "step"
  | "sleep"
  | "child_workflow"
  | "message"
  | "stream"
  | "deterministic"
  | "metadata"
  | "attributes";

/** Status values for workflow-level timeline entries. */
export type TimelineWorkflowStatus = "started" | "completed" | "failed";

/** Status values for durable task timeline entries. */
export type TimelineStepStatus = "started" | "completed" | "failed";

/** Status values for sleep timeline entries. */
export type TimelineSleepStatus = "started" | "completed";

/** Status values for child workflow timeline entries. */
export type TimelineChildWorkflowStatus = "started" | "completed" | "failed";

/** Status values for messageId timeline entries. */
export type TimelineMessageStatus =
  | "send_started"
  | "send_completed"
  | "send_failed"
  | "sent"
  | "waiting"
  | "received"
  | "failed";

/** Status values for stream timeline entries. */
export type TimelineStreamStatus = "started" | "chunk" | "closed" | "failed";

/** Status value for metadata and attribute timeline entries. */
export type TimelineSetStatus = "set";

/** Status value for deterministic-value timeline entries. */
export type TimelineRecordedStatus = "recorded";

/** Base contract for workflow timeline entries. */
export interface TimelineEntry {
  readonly kind: TimelineEntryKind;
}

type WorkflowTimelineStepFields = {
  readonly timestamp: Temporal.Instant;
  readonly stepId: StepId;
  readonly stepName: string;
};

type WorkflowTimelineCountField = {
  readonly count?: number;
};

type WorkflowTimelineOptionalMessageFields = {
  readonly stepId?: StepId;
  readonly stepName?: string;
  readonly count?: number;
  readonly targetRunId?: RunId;
  readonly timeoutAt?: Temporal.Instant;
  readonly payload?: StorageValue;
  readonly error?: WorkflowErrorRecord;
  readonly messageTimestamp?: Temporal.Instant;
  readonly waiterStepIds?: readonly string[];
};

/** Describes the workflow timeline workflow entry contract. */
export type TimelineWorkflowEntry =
  | {
      readonly kind: "workflow";
      readonly status: "started";
      readonly timestamp: Temporal.Instant;
      readonly event: WorkflowStartedEvent;
    }
  | {
      readonly kind: "workflow";
      readonly status: "completed";
      readonly timestamp: Temporal.Instant;
      readonly event: WorkflowCompletedEvent;
    }
  | {
      readonly kind: "workflow";
      readonly status: "failed";
      readonly timestamp: Temporal.Instant;
      readonly event: WorkflowFailedEvent;
    };

/** Describes the workflow timeline step entry contract. */
export type TimelineStepEntry =
  | (WorkflowTimelineStepFields &
      WorkflowTimelineCountField & {
        readonly kind: "step";
        readonly status: "started";
        readonly attempt: number;
        readonly event: WorkflowStepStartedEvent;
      })
  | (WorkflowTimelineStepFields & {
      readonly kind: "step";
      readonly status: "completed";
      readonly attempt: number;
      readonly result?: StorageValue;
      readonly event: WorkflowStepCompletedEvent;
    })
  | (WorkflowTimelineStepFields & {
      readonly kind: "step";
      readonly status: "failed";
      readonly attempt: number;
      readonly error?: WorkflowErrorRecord;
      readonly event: WorkflowStepFailedEvent;
    });

/** Describes the workflow timeline sleep entry contract. */
export type TimelineSleepEntry =
  | (WorkflowTimelineStepFields &
      WorkflowTimelineCountField & {
        readonly kind: "sleep";
        readonly status: "started";
        readonly until?: Temporal.Instant;
        readonly duration?: Temporal.Duration;
        readonly event: SleepStartedEvent;
      })
  | (WorkflowTimelineStepFields & {
      readonly kind: "sleep";
      readonly status: "completed";
      readonly event: SleepCompletedEvent;
    });

/** Describes the workflow timeline child workflow entry contract. */
export type TimelineChildWorkflowEntry =
  | (WorkflowTimelineStepFields &
      WorkflowTimelineCountField & {
        readonly kind: "child_workflow";
        readonly status: "started";
        readonly childRunId: RunId;
        readonly workflowName?: string;
        readonly workflowVersion?: string;
        readonly input?: StorageValue;
        readonly timeoutAt?: Temporal.Instant;
        readonly event: ChildWorkflowStartedEvent;
      })
  | (WorkflowTimelineStepFields & {
      readonly kind: "child_workflow";
      readonly status: "completed";
      readonly childRunId: RunId;
      readonly result?: StorageValue;
      readonly event: ChildWorkflowCompletedEvent;
    })
  | (WorkflowTimelineStepFields & {
      readonly kind: "child_workflow";
      readonly status: "failed";
      readonly childRunId: RunId;
      readonly error?: WorkflowErrorRecord;
      readonly event: ChildWorkflowFailedEvent;
    });

/** Describes the workflow timeline messageId entry contract. */
export type TimelineMessageEntry =
  | (WorkflowTimelineOptionalMessageFields &
      WorkflowTimelineStepFields &
      WorkflowTimelineCountField & {
        readonly kind: "message";
        readonly status: "send_started";
        readonly targetRunId: RunId;
        readonly messageId: MessageId;
        readonly event: MessageSendStartedEvent;
      })
  | (WorkflowTimelineOptionalMessageFields &
      WorkflowTimelineStepFields & {
        readonly kind: "message";
        readonly status: "send_completed";
        readonly targetRunId: RunId;
        readonly messageId: MessageId;
        readonly event: MessageSendCompletedEvent;
      })
  | (WorkflowTimelineOptionalMessageFields &
      WorkflowTimelineStepFields & {
        readonly kind: "message";
        readonly status: "send_failed";
        readonly targetRunId: RunId;
        readonly messageId: MessageId;
        readonly error?: WorkflowErrorRecord;
        readonly event: MessageSendFailedEvent;
      })
  | (WorkflowTimelineOptionalMessageFields & {
      readonly kind: "message";
      readonly status: "sent";
      readonly timestamp: Temporal.Instant;
      readonly messageId: MessageId;
      readonly payload?: StorageValue;
      readonly event: MessageSentEvent;
    })
  | (WorkflowTimelineOptionalMessageFields &
      WorkflowTimelineStepFields &
      WorkflowTimelineCountField & {
        readonly kind: "message";
        readonly status: "waiting";
        readonly messageId: MessageId;
        readonly timeoutAt?: Temporal.Instant;
        readonly event: MessageWaitStartedEvent;
      })
  | (WorkflowTimelineOptionalMessageFields &
      WorkflowTimelineStepFields & {
        readonly kind: "message";
        readonly status: "received";
        readonly messageId: MessageId;
        readonly payload?: StorageValue;
        readonly messageTimestamp?: Temporal.Instant;
        readonly event: MessageWaitCompletedEvent;
      })
  | (WorkflowTimelineOptionalMessageFields &
      WorkflowTimelineStepFields & {
        readonly kind: "message";
        readonly status: "failed";
        readonly messageId: MessageId;
        readonly error?: WorkflowErrorRecord;
        readonly event: MessageWaitFailedEvent;
      });

/** Describes the workflow timeline metadata entry contract. */
export type TimelineMetadataEntry = WorkflowTimelineStepFields & {
  readonly kind: "metadata";
  readonly status: TimelineSetStatus;
  readonly count: number;
  readonly metadata: StorageValue;
  readonly event: MetadataSetEvent;
};

/** Describes the workflow timeline attributes entry contract. */
export type TimelineAttributesEntry = WorkflowTimelineStepFields & {
  readonly kind: "attributes";
  readonly status: TimelineSetStatus;
  readonly count: number;
  readonly attributes: WorkflowAttributePatch;
  readonly event: AttributesSetEvent;
};

/** Describes the workflow timeline stream entry contract. */
export type TimelineStreamEntry =
  | (WorkflowTimelineStepFields &
      WorkflowTimelineCountField & {
        readonly kind: "stream";
        readonly status: "started";
        readonly streamId: StreamId;
        readonly contentType?: string;
        readonly metadata?: StorageValue;
        readonly event: StreamStartedEvent;
      })
  | (WorkflowTimelineStepFields & {
      readonly kind: "stream";
      readonly status: "chunk";
      readonly streamId: StreamId;
      readonly index: number;
      readonly chunk?: StorageValue;
      readonly event: StreamChunkEvent;
    })
  | (WorkflowTimelineStepFields & {
      readonly kind: "stream";
      readonly status: "closed";
      readonly streamId: StreamId;
      readonly event: StreamClosedEvent;
    })
  | (WorkflowTimelineStepFields & {
      readonly kind: "stream";
      readonly status: "failed";
      readonly streamId: StreamId;
      readonly error?: WorkflowErrorRecord;
      readonly event: StreamFailedEvent;
    });

/** Describes the workflow timeline deterministic entry contract. */
export type TimelineDeterministicEntry = WorkflowTimelineStepFields & {
  readonly kind: "deterministic";
  readonly status: TimelineRecordedStatus;
  readonly count: number;
  readonly value: StorageValue;
  readonly event: DeterministicValueRecordedEvent;
};

/** Type used for workflow timeline entry values. */
export type TimelineEntryRecord =
  | TimelineWorkflowEntry
  | TimelineStepEntry
  | TimelineSleepEntry
  | TimelineChildWorkflowEntry
  | TimelineMessageEntry
  | TimelineStreamEntry
  | TimelineDeterministicEntry
  | TimelineMetadataEntry
  | TimelineAttributesEntry;
