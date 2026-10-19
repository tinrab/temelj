import { streamedMdxChunks } from "../../../../content.ts";

export function GET(): Response {
  const encoder = new TextEncoder();
  const chunks = streamedMdxChunks.values();

  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks.next();

      if (chunk.done) {
        controller.close();

        return;
      }

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
