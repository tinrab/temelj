import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { StreamContent, useMdxStream } from "@temelj/mdx-react";
import { useEffect, useRef, useState } from "react";

import { mdxRegistry } from "~/components/registry";
import { Button } from "~/components/ui/button";
import { Slider } from "~/components/ui/slider";

import { mdxSyntax, streamedMdxChunks } from "../../../content";
import { pacedChunks } from "../../../streaming.ts";

const streamMdx = createServerFn().handler(async function* () {
  yield* streamedMdxChunks;
});

export const Route = createFileRoute("/streaming")({ component: StreamingExampleRoute });

function StreamingExampleRoute(): React.ReactNode {
  const { view, consume, reset } = useMdxStream({ syntax: mdxSyntax });
  const [error, setError] = useState<string>();
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const playbackSpeed = useRef(speed);
  const activeStream = useRef<AbortController | undefined>(undefined);

  useEffect(() => () => activeStream.current?.abort(), []);

  const start = async (): Promise<void> => {
    activeStream.current?.abort();
    const controller = new AbortController();
    activeStream.current = controller;
    reset();
    setError(undefined);
    setRunning(true);

    try {
      const chunks = await streamMdx({ signal: controller.signal });
      await consume(
        pacedChunks(chunks, { signal: controller.signal, speed: () => playbackSpeed.current }),
        { signal: controller.signal },
      );
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "The stream failed");
      }
    } finally {
      if (activeStream.current === controller) {
        activeStream.current = undefined;
        setRunning(false);
      }
    }
  };

  const changeSpeed = (value: number): void => {
    playbackSpeed.current = value;
    setSpeed(value);
  };

  return (
    <>
      <h1 className="text-3xl font-bold">Streaming MDX</h1>
      <div className="flex flex-wrap items-center gap-6">
        <Button onPress={() => void start()}>Start</Button>
        <div className="flex w-56 flex-col gap-3">
          <div className="flex items-center justify-between text-sm">
            <span>Speed</span>
            <output className="text-muted-foreground tabular-nums">{speed}x</output>
          </div>
          <Slider
            aria-label="Stream speed"
            minValue={0.25}
            maxValue={4}
            step={0.25}
            value={speed}
            onChange={changeSpeed}
          />
        </div>
      </div>
      <section
        aria-busy={running}
        aria-label="Streamed MDX output"
        className="typeset streaming-caret min-h-80 rounded-lg border p-4"
        data-streaming={running}
      >
        {view.generation === 0 ? (
          <p>Press Start to stream the document.</p>
        ) : (
          <StreamContent registry={mdxRegistry} view={view} />
        )}
      </section>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
