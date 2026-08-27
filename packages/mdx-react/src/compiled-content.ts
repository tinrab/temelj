import React from "react";

import type { MathComponent, CompiledMdxComponents, CompiledContentModule } from "./types.ts";

interface CompiledContentOptions<Props extends object> {
  readonly components?: CompiledMdxComponents;
  readonly math?: MathComponent;
  readonly module: CompiledContentModule<Props>;
}

export type CompiledContentProps<Props extends object = Record<never, never>> =
  CompiledContentOptions<Props> &
    (Record<never, never> extends Props
      ? { readonly props?: Readonly<Props> }
      : { readonly props: Readonly<Props> });

interface RuntimeCompiledContentOptions {
  readonly components?: CompiledMdxComponents;
  readonly math?: MathComponent;
  readonly module: Readonly<{ default: React.ElementType }>;
  readonly props?: object;
}

/** Renders a trusted module that the caller compiled and evaluated explicitly. */
export function CompiledContent<Props extends object = Record<never, never>>(
  options: CompiledContentProps<Props>,
): React.ReactNode;
export function CompiledContent({
  components,
  math,
  module,
  props,
}: RuntimeCompiledContentOptions): React.ReactNode {
  return React.createElement(module.default, { ...props, components, math });
}
