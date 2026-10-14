import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { StreamContent, useMdxStream } from "@temelj/mdx-react";
import { useEffect, useState } from "react";

import { mdxRegistry } from "~/components/registry";

import { mdxSyntax, streamDelayMilliseconds, streamedMdxChunks } from "../../../content";

const streamMdx = createServerFn().handler(async function* () {
  for (const content of streamedMdxChunks) {
    await new Promise((resolve) => setTimeout(resolve, streamDelayMilliseconds(content)));
    yield content;
  }
});

export const Route = createFileRoute("/streaming")({ component: StreamingExampleRoute });

function StreamingExampleRoute(): React.ReactNode {
  const { view, consume } = useMdxStream({ syntax: mdxSyntax });
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();

    streamMdx({ signal: controller.signal })
      .then((chunks) => consume(chunks, { signal: controller.signal }))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "The stream failed");
        }
      });

    return () => controller.abort();
  }, [consume]);

  return (
    <>
      <h1 className="text-3xl font-bold">Streaming MDX</h1>
      <section
        aria-busy={view.kind === "streaming" && error === undefined}
        aria-label="Streamed MDX output"
        className="typeset streaming-caret min-h-80 rounded-lg border p-4"
        data-streaming={view.kind === "streaming"}
      >
        <StreamContent registry={mdxRegistry} view={view} />
      </section>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
