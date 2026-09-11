"use client";

import { StreamingSourceContent } from "@temelj/mdx-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { KaTeXMath } from "@/components/katex-math";
import { mdxRegistry } from "@/components/mdx-registry";
import { Button } from "@/components/ui/button";

import { mdxSyntax } from "../../content.ts";

type StreamState = "idle" | "streaming" | "stopped" | "complete" | "error";

export function StreamingExample(): React.ReactNode {
  const [source, setSource] = useState("");
  const [state, setState] = useState<StreamState>("idle");
  const [errorMessage, setErrorMessage] = useState<string>();
  const activeRequest = useRef<AbortController | undefined>(undefined);

  useEffect(() => () => activeRequest.current?.abort(), []);

  const start = useCallback(async () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setSource("");
    setErrorMessage(undefined);
    setState("streaming");

    try {
      const response = await fetch("/api/mdx", {
        cache: "no-store",
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`The stream returned HTTP ${response.status}`);
      }

      if (response.body === null) {
        throw new Error("The stream response did not include a body");
      }

      const decoder = new TextDecoder();
      const reader = response.body.getReader();

      while (true) {
        const result = await reader.read();

        if (result.done) {
          break;
        }

        const content = decoder.decode(result.value, { stream: true });

        if (content.length > 0) {
          setSource((current) => current + content);
        }
      }

      const remaining = decoder.decode();

      if (remaining.length > 0) {
        setSource((current) => current + remaining);
      }

      if (activeRequest.current === controller) {
        setState("complete");
      }
    } catch (error) {
      if (!controller.signal.aborted && activeRequest.current === controller) {
        setErrorMessage(error instanceof Error ? error.message : "The stream failed");
        setState("error");
      }
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = undefined;
      }
    }
  }, []);

  const stop = useCallback(() => {
    activeRequest.current?.abort();
    activeRequest.current = undefined;
    setState("stopped");
  }, []);

  return (
    <>
      <h1 className="text-3xl font-bold">Streaming MDX</h1>

      <div className="flex items-center gap-3">
        <Button onPress={state === "streaming" ? stop : () => void start()}>
          {streamButtonLabel(state)}
        </Button>
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
              source={source}
              status={state === "complete" ? "complete" : "streaming"}
              syntax={mdxSyntax}
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
        <p className="text-destructive" role="alert">
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
