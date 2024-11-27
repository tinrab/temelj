import * as React from "react";
import jsxRuntime from "react/jsx-runtime";
import type { MdxArtifact } from "@temelj/mdx";

import type { MdxContentComponents } from "./types.ts";

interface MdxContentOptions<
  TFrontmatter = Record<string, unknown>,
  TScope = unknown,
> {
  artifact: MdxArtifact<TFrontmatter>;
  scope?: TScope;
}

export function createMdxContent<
  TFrontmatter = Record<string, unknown>,
  TScope = unknown,
>(
  options: MdxContentOptions<TFrontmatter, TScope>,
  components: MdxContentComponents = {},
): React.ReactNode {
  let compiled: string | undefined;
  if (options.artifact.compiled !== undefined) {
    compiled = options.artifact.compiled.value.toString();
  }

  let content: React.ReactNode;
  if (compiled !== undefined) {
    const scope = Object.assign(
      {
        opts: { ...jsxRuntime, useMDXComponents: () => components },
      },
      { frontmatter: options.artifact.frontmatter },
      options.scope ?? {},
    );
    const keys = Object.keys(scope);
    const values = Object.values(scope);

    const hydrateFn = Reflect.construct(Function, [...keys, compiled]);
    content = React.createElement(hydrateFn.apply(hydrateFn, values).default, {
      components,
    });
  }

  return content;
}
