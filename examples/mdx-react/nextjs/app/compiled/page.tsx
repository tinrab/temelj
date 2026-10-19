import { CompiledContent, compileTrustedMdx } from "@temelj/mdx-react";

import { compiledMdxRegistry } from "@/components/compiled-mdx-registry";

import { compiledMdxSource, mdxSyntax } from "../../../content.ts";

export default async function CompiledPage(): Promise<React.ReactNode> {
  const outcome = await compileTrustedMdx(compiledMdxSource, { syntax: mdxSyntax });

  return (
    <article className="typeset">
      <CompiledContent module={outcome.module} registry={compiledMdxRegistry} />
    </article>
  );
}
