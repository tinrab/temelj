import type { FunctionBodyCompileArtifact } from "@temelj/mdx";
import type { TrustedMdxEvaluationOutcome } from "@temelj/mdx-react";

import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { compileMdx } from "@temelj/mdx";
import { CompiledContent, evaluateTrustedMdx } from "@temelj/mdx-react";
import React from "react";

import { KaTeXMath } from "~/components/KaTeXMath";
import { mdxRegistry } from "~/components/registry";

import { compiledMdxSource, mdxSyntax } from "../../../content";

const loadCompiledMdx = createServerFn({ method: "GET" }).handler(async () => {
  const outcome = await compileMdx(compiledMdxSource, {
    outputFormat: "functionBody",
    syntax: mdxSyntax,
  });
  if (outcome.kind !== "compiled") {
    return {
      kind: "invalid" as const,
      diagnostics: outcome.diagnostics.map(({ code, message }) => ({ code, message })),
    };
  }
  if (outcome.artifact.format !== "functionBody") {
    throw new Error("Expected a function-body MDX artifact");
  }
  return { kind: "compiled" as const, artifact: outcome.artifact };
});

const evaluations = new WeakMap<
  FunctionBodyCompileArtifact,
  Promise<TrustedMdxEvaluationOutcome>
>();

export const Route = createFileRoute("/compiled")({
  loader: () => loadCompiledMdx(),
  component: CompiledRoute,
});

function CompiledRoute(): React.ReactNode {
  const result = Route.useLoaderData();
  if (result.kind === "invalid") {
    return (
      <pre className="border-error text-error rounded border p-4 whitespace-pre-wrap">
        {result.diagnostics.map(({ code, message }) => `${code}: ${message}`).join("\n")}
      </pre>
    );
  }

  const evaluation = React.use(evaluationFor(result.artifact));
  if (evaluation.kind !== "evaluated") {
    return (
      <pre className="border-error text-error rounded border p-4 whitespace-pre-wrap">
        {evaluation.diagnostics.map(({ code, message }) => `${code}: ${message}`).join("\n")}
      </pre>
    );
  }
  return (
    <article className="typeset">
      <CompiledContent registry={mdxRegistry} math={KaTeXMath} module={evaluation.module} />
    </article>
  );
}

function evaluationFor(
  artifact: FunctionBodyCompileArtifact,
): Promise<TrustedMdxEvaluationOutcome> {
  const existing = evaluations.get(artifact);
  if (existing !== undefined) {
    return existing;
  }
  const evaluation = evaluateTrustedMdx(artifact);
  evaluations.set(artifact, evaluation);
  return evaluation;
}
