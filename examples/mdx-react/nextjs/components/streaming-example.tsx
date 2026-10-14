"use client";

import { StreamContent, useMdxStream } from "@temelj/mdx-react";
import { useEffect, useState } from "react";

import { mdxRegistry } from "@/components/mdx-registry";

import { mdxSyntax } from "../../content.ts";

export function StreamingExample(): React.ReactNode {
  const { view, consume } = useMdxStream({ syntax: mdxSyntax });
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/mdx", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error("Could not load the MDX stream");
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
