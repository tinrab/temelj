import { CompiledContent, compileTrustedMdx } from "@temelj/mdx-react";

import { compiledMdxRegistry } from "@/components/compiled-mdx-registry";

import { compiledMdxSource, mdxSyntax } from "../../../content.ts";

export default async function CompiledPage(): Promise<React.ReactNode> {
  const outcome = await compileTrustedMdx(compiledMdxSource, { syntax: mdxSyntax });

  if (outcome.kind !== "ok") {
    return (
      <pre className="border-destructive text-destructive rounded border p-4 whitespace-pre-wrap">
        {outcome.diagnostics
          .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
          .join("\n")}
      </pre>
    );
  }

  return (
    <article className="typeset">
      <CompiledContent module={outcome.module} registry={compiledMdxRegistry} />
    </article>
  );
}
