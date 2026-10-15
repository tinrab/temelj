"use client";

import { StreamContent, useMdxBlocks } from "@temelj/mdx-react";
import { useEffect, useState } from "react";

import { mdxRegistry } from "@/components/mdx-registry";

/** Renders block events from the server. The parser never runs in the browser. */
export function ServerStreamingExample(): React.ReactNode {
  const { view, consume } = useMdxBlocks();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/mdx-blocks", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error("Could not load the block stream");
        }

        return consume(response, { signal: controller.signal });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "The stream failed");
        }
      });

    return () => controller.abort();
  }, [consume]);

  return (
    <>
      <h1 className="text-3xl font-bold">Server-parsed streaming</h1>
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
