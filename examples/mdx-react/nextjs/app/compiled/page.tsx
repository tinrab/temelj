import { CompiledContent, compileTrustedMdx } from "@temelj/mdx-react";

import { compiledMdxRegistry } from "@/components/compiled-mdx-registry";
import { KaTeXMath } from "@/components/katex-math";

import { mdxSyntax, staticMdxSource } from "../../../content.ts";

export default async function CompiledPage(): Promise<React.ReactNode> {
  const outcome = await compileTrustedMdx(staticMdxSource, { syntax: mdxSyntax });
  if (outcome.kind !== "compiled") {
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
      <CompiledContent registry={compiledMdxRegistry} math={KaTeXMath} module={outcome.module} />
    </article>
  );
}
