import { streamDelayMilliseconds, streamedMdxChunks } from "../../../../content.ts";

export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  const encoder = new TextEncoder();
  let cancelled = false;

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const content of streamedMdxChunks) {
        const delayMilliseconds = streamDelayMilliseconds(content);
        const ready = await waitForChunk(delayMilliseconds, request.signal);

        if (!ready || cancelled) {
          if (!cancelled) {
            controller.close();
          }

          return;
        }

        controller.enqueue(encoder.encode(content));
      }

      controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(body, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function waitForChunk(milliseconds: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const finish = (completed: boolean): void => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      resolve(completed);
    };

    const abort = (): void => finish(false);
    const timeout = setTimeout(() => finish(true), milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}
