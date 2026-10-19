import { streamBlockEvents } from "@temelj/mdx";
import { setTimeout } from "node:timers/promises";

import { mdxSyntax, streamDelayMilliseconds, streamedMdxChunks } from "../../../../content.ts";

/**
 * Parses the stream on the server and sends block events as newline-delimited
 * JSON, so the client renders trees without parsing.
 */
export function GET(request: Request): Response {
  async function* chunks(): AsyncGenerator<string> {
    for (const chunk of streamedMdxChunks) {
      // The request signal aborts the delay when the client disconnects.
      await setTimeout(streamDelayMilliseconds(chunk), undefined, { signal: request.signal });
      yield chunk;
    }
  }

  const encoder = new TextEncoder();
  const events = streamBlockEvents(chunks(), { syntax: mdxSyntax });

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const event = await events.next();

      if (event.done === true) {
        controller.close();

        return;
      }

      controller.enqueue(encoder.encode(`${JSON.stringify(event.value)}\n`));
    },
    async cancel() {
      await events.return(undefined);
    },
  });

  return new Response(body, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "application/x-ndjson; charset=utf-8",
    },
  });
}
