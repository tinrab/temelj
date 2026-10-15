import { setTimeout } from "node:timers/promises";

import { chatAnswers, tokenChunks } from "../../../../content.ts";

/** Streams one canned answer as plain text, a few words at a time. */
export function GET(request: Request): Response {
  const index = Number(new URL(request.url).searchParams.get("answer") ?? 0);
  const answer = chatAnswers[Math.abs(index) % chatAnswers.length];
  const encoder = new TextEncoder();
  const chunks = tokenChunks(answer).values();

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const chunk = chunks.next();

      if (chunk.done) {
        controller.close();

        return;
      }

      await setTimeout(40, undefined, { signal: request.signal });
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
