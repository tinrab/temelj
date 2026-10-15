import type { FunctionBodyCompileArtifact } from "@temelj/mdx";
import type { CompiledContentModule } from "@temelj/mdx-react";

import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { compile, Processor } from "@temelj/mdx";
import { CompiledContent, evaluateTrustedMdx } from "@temelj/mdx-react";
import React from "react";

import { mdxRegistry } from "~/components/registry";

import { compiledMdxSource, mdxSyntax } from "../../../content";

const loadCompiledMdx = createServerFn({ method: "GET" }).handler(async () => {
  const transformed = await new Processor({ syntax: mdxSyntax }).transform(compiledMdxSource);
  const outcome = await compile(transformed, { outputFormat: "functionBody" });

  return outcome.artifact;
});

const evaluations = new WeakMap<FunctionBodyCompileArtifact, Promise<CompiledContentModule>>();

export const Route = createFileRoute("/compiled")({
  loader: () => loadCompiledMdx(),
  component: CompiledRoute,
});

function CompiledRoute(): React.ReactNode {
  const artifact = Route.useLoaderData();
  const module = React.use(evaluationFor(artifact));

  return (
    <article className="typeset">
      <CompiledContent module={module} registry={mdxRegistry} />
    </article>
  );
}

function evaluationFor(artifact: FunctionBodyCompileArtifact): Promise<CompiledContentModule> {
  const existing = evaluations.get(artifact);

  if (existing !== undefined) {
    return existing;
  }

  const evaluation = evaluateTrustedMdx(artifact);
  evaluations.set(artifact, evaluation);

  return evaluation;
}
