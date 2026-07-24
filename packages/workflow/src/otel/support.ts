import {
  SpanStatusCode,
  context,
  propagation,
  type Context,
  type Span,
  type SpanContext,
} from "@opentelemetry/api";

import type { StreamEventKind } from "../types/events.ts";
import type { TelemetryContext } from "../types/telemetry.ts";

import { WORKFLOW_ATTRIBUTES } from "../telemetry.ts";

class WorkflowTelemetryException extends Error {
  constructor(message: string, name: string, context?: Function) {
    super(message);
    this.name = name;

    if (Error.captureStackTrace !== undefined) {
      Error.captureStackTrace(this, context ?? this.constructor);
    }
  }

  static fromRecord(
    this: void,
    error: { readonly message: string; readonly name: string },
  ): WorkflowTelemetryException {
    return new WorkflowTelemetryException(
      error.message,
      error.name,
      WorkflowTelemetryException.fromRecord,
    );
  }

  static fromUnknown(this: void, error: unknown): WorkflowTelemetryException {
    return new WorkflowTelemetryException(
      String(error),
      "Error",
      WorkflowTelemetryException.fromUnknown,
    );
  }
}

export async function withRunSpanStatus<T>(span: Span, callback: () => Promise<T>): Promise<T> {
  try {
    const result = await callback();
    recordWorkflowResultOnSpan(span, result);
    return result;
  } catch (error) {
    span.recordException(toException(error));
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw error;
  } finally {
    span.end();
  }
}

export async function withSpanStatus<T>(span: Span, callback: () => Promise<T>): Promise<T> {
  try {
    const result = await callback();
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.recordException(toException(error));
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw error;
  } finally {
    span.end();
  }
}

function recordWorkflowResultOnSpan(span: Span, result: unknown): void {
  if (!isExecutionResult(result)) {
    span.setStatus({ code: SpanStatusCode.OK });
    return;
  }
  span.setAttributes({
    [WORKFLOW_ATTRIBUTES.runStatus]: result.run.status,
    [WORKFLOW_ATTRIBUTES.runTransition]: result.run.lastTransitionReason,
  });
  if (result.kind === "failed") {
    span.recordException(result.error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: result.error.message });
    return;
  }
  span.setStatus({ code: SpanStatusCode.OK });
}

function isExecutionResult(result: unknown): result is
  | {
      readonly kind: "completed" | "waiting";
      readonly run: { readonly lastTransitionReason: string; readonly status: string };
    }
  | {
      readonly error: Error;
      readonly kind: "failed";
      readonly run: { readonly lastTransitionReason: string; readonly status: string };
    } {
  if (typeof result !== "object" || result === null || !("kind" in result) || !("run" in result)) {
    return false;
  }
  const kind = result.kind;
  return kind === "completed" || kind === "failed" || kind === "waiting";
}

export function contextFromTraceContext(traceContext: TelemetryContext | undefined): Context {
  if (traceContext === undefined) {
    return context.active();
  }
  return propagation.extract(context.active(), {
    ...(traceContext.traceparent === undefined ? {} : { traceparent: traceContext.traceparent }),
    ...(traceContext.tracestate === undefined ? {} : { tracestate: traceContext.tracestate }),
  });
}

export function spanLinkFromTraceContext(
  traceContext: TelemetryContext | undefined,
): { readonly context: SpanContext } | undefined {
  if (traceContext?.traceparent === undefined) {
    return undefined;
  }
  const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/iu.exec(traceContext.traceparent);
  if (match === null) {
    return undefined;
  }
  const [, traceId, spanId, flags] = match;
  if (traceId === "0".repeat(32) || spanId === "0".repeat(16)) {
    return undefined;
  }
  return {
    context: {
      traceId,
      spanId,
      traceFlags: Number.parseInt(flags, 16) & 1,
    },
  };
}

export function streamStatusFromEventKind(
  eventKind: StreamEventKind,
): "open" | "closed" | "failed" {
  switch (eventKind) {
    case "stream_started":
    case "stream_chunk":
      return "open";
    case "stream_closed":
      return "closed";
    case "stream_failed":
      return "failed";
  }
}

export function errorRecordToException(error: {
  readonly message: string;
  readonly name: string;
}): Error {
  return WorkflowTelemetryException.fromRecord(error);
}

export function toException(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return WorkflowTelemetryException.fromUnknown(error);
}
