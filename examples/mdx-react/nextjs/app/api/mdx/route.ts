import { setTimeout } from "node:timers/promises";

import { streamDelayMilliseconds, streamedMdxChunks } from "../../../../content.ts";

export function GET(request: Request): Response {
  const encoder = new TextEncoder();
  const chunks = streamedMdxChunks.values();

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const chunk = chunks.next();

      if (chunk.done) {
        controller.close();

        return;
      }

      // The request signal aborts the delay when the client disconnects.
      await setTimeout(streamDelayMilliseconds(chunk.value), undefined, { signal: request.signal });
      controller.enqueue(encoder.encode(chunk.value));
    },
  });

  return new Response(body, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
