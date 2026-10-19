import {
  SpanStatusCode,
  context,
  propagation,
  type Context,
  type Span,
  type SpanContext,
} from "@opentelemetry/api";

import type { StreamEventKind } from "../types/events.ts";
import type { ExecutionResult } from "../types/result.ts";
import type { TelemetryContext } from "../types/telemetry.ts";

import { omitUndefined } from "../collection.ts";
import { WORKFLOW_ATTRIBUTES } from "../telemetry.ts";

class TelemetryException extends Error {
  constructor(message: string, name: string) {
    super(message);
    this.name = name;
  }

  static fromRecord(
    this: void,
    error: { readonly message: string; readonly name: string },
  ): TelemetryException {
    return new TelemetryException(error.message, error.name);
  }

  static fromUnknown(this: void, cause: unknown): TelemetryException {
    return new TelemetryException(String(cause), "Error");
  }
}

interface SpanStatusHooks<T> {
  /** Records a successful result; the span status defaults to OK when this is absent. */
  readonly onSuccess?: (result: T) => void;
  readonly onFailure?: () => void;
}

/** Runs `callback` in `span`, records its outcome, and ends the span. */
export async function withSpanStatus<T>(
  span: Span,
  callback: () => Promise<T>,
  hooks: SpanStatusHooks<T> = {},
): Promise<T> {
  try {
    const result = await callback();

    if (hooks.onSuccess === undefined) {
      span.setStatus({ code: SpanStatusCode.OK });
    } else {
      hooks.onSuccess(result);
    }

    return result;
  } catch (error) {
    hooks.onFailure?.();
    span.recordException(toException(error));
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw error;
  } finally {
    span.end();
  }
}

export function recordResultOnSpan(span: Span, result: ExecutionResult): void {
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

export function contextFromTraceContext(traceContext: TelemetryContext | undefined): Context {
  if (traceContext === undefined) {
    return context.active();
  }

  return propagation.extract(context.active(), omitUndefined(traceContext));
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
  return TelemetryException.fromRecord(error);
}

export function toException(cause: unknown): Error {
  if (cause instanceof Error) {
    return cause;
  }

  return TelemetryException.fromUnknown(cause);
}
