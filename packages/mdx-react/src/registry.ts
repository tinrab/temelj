import type React from "react";

import type {
  MathComponent,
  MdxJsxComponentOptions,
  MdxMarkdownComponents,
  MdxPendingComponents,
  PendingMdxJsxProps,
} from "./types.ts";

type HtmlComponents = Readonly<Record<string, React.ElementType>>;

type JsxComponents = Readonly<Record<string, React.ElementType>>;

type JsxDefinitions<Components extends JsxComponents> = {
  readonly [Name in keyof Components]: Omit<MdxJsxComponentOptions<Components[Name]>, "pending"> & {
    readonly pending?: React.ComponentType<PendingMdxJsxProps<NoInfer<Components[Name]>>> | null;
  };
};

export interface MdxRegistryDefinition<Html extends HtmlComponents, Jsx extends JsxComponents> {
  /** Overrides for lowered HTML elements, keyed by tag name. */
  readonly html?: Html;
  /** Components that authored JSX may render, keyed by element name. */
  readonly jsx?: JsxDefinitions<Jsx>;
  readonly markdown?: MdxMarkdownComponents;
  /** Renders math. Without it, math keeps its readable code fallback. */
  readonly math?: MathComponent;
  readonly pending?: MdxPendingComponents;
}

export interface MdxRegistryEntry {
  readonly component: React.ElementType;
  readonly pending?: React.ElementType | null;
}

/** The components every MDX renderer and compiled document resolve against. */
export interface MdxRegistry {
  readonly html: Readonly<Record<string, React.ElementType>>;
  readonly jsx: Readonly<Record<string, MdxRegistryEntry>>;
  readonly markdown: MdxMarkdownComponents;
  readonly math?: MathComponent;
  readonly pending: MdxPendingComponents;
}

export function defineMdxRegistry<
  const Html extends HtmlComponents = Record<never, never>,
  const Jsx extends JsxComponents = Record<never, never>,
>(definition: MdxRegistryDefinition<Html, Jsx>): MdxRegistry {
  const jsx: Record<string, MdxRegistryEntry> = {};

  for (const [name, entry] of Object.entries(definition.jsx ?? {})) {
    jsx[name] = Object.freeze({ component: entry.component, pending: entry.pending });
  }

  return Object.freeze({
    html: Object.freeze({ ...definition.html }),
    jsx: Object.freeze(jsx),
    markdown: Object.freeze({ ...definition.markdown }),
    math: definition.math,
    pending: Object.freeze({ ...definition.pending }),
  });
}
