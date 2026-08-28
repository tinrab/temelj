import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { StreamingSourceContent } from "@temelj/mdx-react";
import { useCallback, useRef, useState } from "react";

import { KaTeXMath } from "~/components/KaTeXMath";
import { mdxRegistry } from "~/components/registry";

import { mdxSyntax, streamDelayMilliseconds, streamedMdxChunks } from "../../../content";

interface MdxStreamChunk {
  readonly content: string;
  readonly sequence: number;
}

const streamMdx = createServerFn().handler(async function* () {
  for (const [sequence, content] of streamedMdxChunks.entries()) {
    const delayMilliseconds = streamDelayMilliseconds(content);
    await new Promise((resolve) => setTimeout(resolve, delayMilliseconds));
    yield { content, sequence } satisfies MdxStreamChunk;
  }
});

export const Route = createFileRoute("/streaming")({ component: StreamingExampleRoute });

type StreamState = "idle" | "streaming" | "stopped" | "complete" | "error";

function StreamingExampleRoute(): React.ReactNode {
  const [source, setSource] = useState("");
  const [state, setState] = useState<StreamState>("idle");
  const [errorMessage, setErrorMessage] = useState<string>();
  const activeRun = useRef(0);

  const start = useCallback(async () => {
    const run = activeRun.current + 1;
    activeRun.current = run;
    setSource("");
    setErrorMessage(undefined);
    setState("streaming");

    try {
      for await (const chunk of await streamMdx()) {
        if (activeRun.current !== run) {
          return;
        }
        setSource((current) => current + chunk.content);
      }
      if (activeRun.current === run) {
        setState("complete");
      }
    } catch (error) {
      if (activeRun.current === run) {
        setErrorMessage(error instanceof Error ? error.message : "The stream failed");
        setState("error");
      }
    }
  }, []);

  const stop = useCallback(() => {
    activeRun.current += 1;
    setState("stopped");
  }, []);

  return (
    <>
      <h1 className="text-3xl font-bold">Streaming MDX</h1>

      <div className="flex items-center gap-3">
        <button
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium"
          onClick={state === "streaming" ? stop : () => void start()}
          type="button"
        >
          {streamButtonLabel(state)}
        </button>
        <output aria-live="polite" className="text-muted-foreground text-sm">
          {statusLabel(state)}
        </output>
      </div>

      <section
        aria-busy={state === "streaming"}
        aria-label="Streamed MDX output"
        className="min-h-80 rounded-lg border p-4"
      >
        {source.length === 0 ? (
          <p className="text-muted-foreground">Start the stream to render the incoming MDX.</p>
        ) : (
          <div className="typeset">
            <StreamingSourceContent
              registry={mdxRegistry}
              math={KaTeXMath}
              syntax={mdxSyntax}
              source={source}
              status={state === "complete" ? "complete" : "streaming"}
            />
            {state === "streaming" ? (
              <span aria-hidden="true" className="inline-block animate-pulse">
                ▋
              </span>
            ) : null}
          </div>
        )}
      </section>

      {errorMessage === undefined ? null : (
        <p className="text-error" role="alert">
          {errorMessage}
        </p>
      )}
    </>
  );
}

function statusLabel(state: StreamState): string {
  switch (state) {
    case "idle":
      return "Ready";
    case "streaming":
      return "Receiving MDX...";
    case "stopped":
      return "Stream stopped";
    case "complete":
      return "Stream complete";
    case "error":
      return "Stream failed";
  }
}

function streamButtonLabel(state: StreamState): string {
  switch (state) {
    case "streaming":
      return "Stop stream";
    case "complete":
    case "error":
      return "Stream again";
    case "idle":
    case "stopped":
      return "Start stream";
  }
}
