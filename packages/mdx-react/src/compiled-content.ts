import React from "react";

import type { MdxRegistry } from "./registry.ts";
import type { MathComponent, CompiledContentModule } from "./types.ts";

interface CompiledContentOptions<Props extends object> {
  readonly registry?: MdxRegistry;
  readonly math?: MathComponent;
  readonly module: CompiledContentModule<Props>;
}

export type CompiledContentProps<Props extends object = Record<never, never>> =
  CompiledContentOptions<Props> &
    (Record<never, never> extends Props
      ? { readonly props?: Readonly<Props> }
      : { readonly props: Readonly<Props> });

interface RuntimeCompiledContentOptions {
  readonly registry?: MdxRegistry;
  readonly math?: MathComponent;
  readonly module: Readonly<{ default: React.ElementType }>;
  readonly props?: object;
}

/** Renders a trusted module that the caller compiled and evaluated explicitly. */
export function CompiledContent<Props extends object = Record<never, never>>(
  options: CompiledContentProps<Props>,
): React.ReactNode;
export function CompiledContent({
  registry,
  math,
  module,
  props,
}: RuntimeCompiledContentOptions): React.ReactNode {
  return React.createElement(module.default, { ...props, registry, math });
}
