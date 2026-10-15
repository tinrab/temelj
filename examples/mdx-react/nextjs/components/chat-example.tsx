"use client";

import { StreamContent, useMdxStream } from "@temelj/mdx-react";
import { memo, useEffect, useState } from "react";

import { mdxRegistry } from "@/components/mdx-registry";
import { Button } from "@/components/ui/button";

import { mdxSyntax } from "../../content.ts";

interface ChatTurn {
  readonly id: number;
  readonly question: string;
}

const questions = [
  "How should a chat app stream Markdown?",
  "How does that compare to re-parsing?",
  "What about math and components?",
] as const;

/**
 * A chat transcript where every assistant message owns its own stream. Earlier
 * messages finish and stop rendering while newer ones keep streaming.
 */
export function ChatExample(): React.ReactNode {
  const [turns, setTurns] = useState<readonly ChatTurn[]>([]);

  const ask = (count: number): void =>
    setTurns((current) => [
      ...current,
      ...Array.from({ length: count }, (_, offset) => {
        const id = current.length + offset;

        return { id, question: questions[id % questions.length] };
      }),
    ]);

  return (
    <>
      <h1 className="text-3xl font-bold">Chat</h1>
      <div className="flex gap-2">
        <Button onPress={() => ask(1)}>Ask</Button>
        <Button onPress={() => ask(3)} variant="outline">
          Ask three at once
        </Button>
      </div>
      <ol aria-label="Messages" className="flex flex-col gap-6">
        {turns.map((turn) => (
          <li className="flex flex-col gap-2" key={turn.id}>
            <p className="bg-muted self-end rounded-lg px-3 py-2">{turn.question}</p>
            <AssistantMessage answer={turn.id} />
          </li>
        ))}
      </ol>
    </>
  );
}

/** One streamed answer. It mounts once, so its stream never restarts. */
const AssistantMessage = memo(function AssistantMessage({
  answer,
}: {
  readonly answer: number;
}): React.ReactNode {
  const { view, consume } = useMdxStream({ syntax: mdxSyntax });
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/chat?answer=${answer}`, { signal: controller.signal })
      .then((response) => consume(response, { signal: controller.signal }))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "The answer failed");
        }
      });

    return () => controller.abort();
  }, [answer, consume]);

  return (
    <article
      aria-busy={view.kind === "streaming"}
      className="typeset streaming-caret rounded-lg border p-4"
      data-streaming={view.kind === "streaming"}
    >
      <StreamContent registry={mdxRegistry} view={view} />
      {error && <p role="alert">{error}</p>}
    </article>
  );
});
