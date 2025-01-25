import React from "react";
import jsxRuntime from "react/jsx-runtime";
import type { MdxArtifact } from "@temelj/mdx";

import type { MdxContentComponents } from "./types.ts";

interface MdxContentOptions<
  TFrontmatter = Record<string, unknown>,
  TScope = unknown,
> {
  artifact: MdxArtifact<TFrontmatter>;
  scope?: TScope;
  importBaseUrl?: string;
}

export function createMdxContent<
  TFrontmatter = Record<string, unknown>,
  TScope = unknown,
>(
  options: MdxContentOptions<TFrontmatter, TScope>,
  components: MdxContentComponents = {},
): React.ReactNode {
  if (options.artifact.compiled !== undefined) {
    const scope = Object.assign(
      {
        opts: {
          ...jsxRuntime,
          useMDXComponents: () => components,
          baseUrl: options.importBaseUrl ?? "/",
        },
      },
      { frontmatter: options.artifact.frontmatter },
      options.scope ?? {},
    );
    const args = Object.keys(scope);
    const values = Object.values(scope);

    const hydrateFn = Reflect.construct(Function, [
      ...args,
      options.artifact.compiled,
    ]);
    return React.createElement(hydrateFn.apply(hydrateFn, values).default, {
      components,
    });
  }
  return Promise.resolve(undefined);
}

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

export function createAsyncMdxContent<
  TFrontmatter = Record<string, unknown>,
  TScope = unknown,
>(
  options: MdxContentOptions<TFrontmatter, TScope>,
  components: MdxContentComponents = {},
): Promise<React.ReactNode> {
  if (options.artifact.compiled !== undefined) {
    const scope = Object.assign(
      {
        opts: {
          ...jsxRuntime,
          useMDXComponents: () => components,
          baseUrl: options.importBaseUrl ?? "/",
        },
      },
      { frontmatter: options.artifact.frontmatter },
      options.scope ?? {},
    );
    const args = Object.keys(scope);
    const values = Object.values(scope);

    const hydrateFn = Reflect.construct(AsyncFunction, [
      ...args,
      options.artifact.compiled,
    ]);
    if (typeof hydrateFn === "function") {
      return Promise.resolve(hydrateFn.apply(hydrateFn, values)).then(
        (result) =>
          React.createElement(result.default, {
            components,
          }),
      );
    }
  }
  return Promise.resolve(undefined);
}
