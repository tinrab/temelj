import type {
  CompiledComponents,
  HtmlAttributes,
  HtmlCodeBlockNode,
  HtmlJsxNode,
  HtmlMathNode,
  HtmlPendingNode,
  HtmlUnresolvedReferenceNode,
  SourceRange,
} from "@temelj/mdx";
import type React from "react";

export type MdxLiteralPropValue = boolean | string;

/** Plain element metadata passed to `html` overrides. It can cross an RSC boundary. */
export interface MdxElementComponentNode {
  readonly kind: "element";
  readonly tagName: string;
  readonly attributes: HtmlAttributes;
  readonly origin?: SourceRange;
}

/** Plain JSX metadata passed to registered JSX components. */
export interface MdxJsxComponentNode {
  readonly kind: "jsx";
  /** `flow` for block JSX, `text` for JSX inside a paragraph. */
  readonly element: "flow" | "text";
  readonly name: string;
  readonly attributes: Readonly<Record<string, MdxLiteralPropValue>>;
  readonly origin?: SourceRange;
}

export type MdxComponentNode = MdxElementComponentNode | MdxJsxComponentNode;

export type MdxComponentProps<Node extends MdxComponentNode = MdxComponentNode> = Readonly<{
  node: Node;
}>;

/** Props a renderer owns. Authored JSX that sets one stays inert. */
export const reservedMdxProps = ["children", "key", "node", "ref"] as const;

type ReservedMdxProp = (typeof reservedMdxProps)[number];

export type PendingMdxJsxProps<Component extends React.ElementType> = Readonly<
  {
    [Key in keyof Omit<React.ComponentPropsWithoutRef<Component>, ReservedMdxProp>]?: Extract<
      NonNullable<React.ComponentPropsWithoutRef<Component>[Key]>,
      MdxLiteralPropValue
    >;
  } & {
    children: React.ReactNode;
    /** The element so far, with `state: "pending"`. */
    node: HtmlJsxNode;
  }
>;

export interface MdxJsxComponentOptions<Component extends React.ElementType> {
  readonly component: Component;
  /** `undefined` inherits the registry pending renderer; `null` renders nothing. */
  readonly pending?: React.ComponentType<PendingMdxJsxProps<Component>> | null;
}

export interface PendingMdxJsxFallbackProps {
  readonly children: React.ReactNode;
  readonly name: string;
  readonly node: HtmlJsxNode;
  readonly props: Readonly<Record<string, MdxLiteralPropValue>>;
}

export interface PendingMdxMarkdownProps {
  /** The node's complete safe default rendering. */
  readonly children: React.ReactNode;
  readonly node: HtmlPendingNode | HtmlUnresolvedReferenceNode;
}

export interface MdxPendingComponents {
  readonly jsx?: React.ComponentType<PendingMdxJsxFallbackProps>;
  readonly markdown?: React.ComponentType<PendingMdxMarkdownProps>;
}

/** One component renders a fence while it streams and after it settles, so it stays mounted. */
export type MdxCodeBlockComponentProps =
  | Readonly<{
      code: string;
      language?: string;
      meta?: string;
      /** The open fence, with `construct: "fence"`. */
      node: HtmlPendingNode;
      status: "pending";
    }>
  | Readonly<{
      code: string;
      language: string;
      meta?: string;
      node: HtmlCodeBlockNode;
      status: "complete";
    }>;

export interface MdxMarkdownComponents {
  readonly codeBlock?: React.ComponentType<MdxCodeBlockComponentProps>;
}

export type MathComponentProps = Readonly<Pick<HtmlMathNode, "meta" | "source" | "style">>;

export type MathComponent = React.ComponentType<MathComponentProps>;

/** Props that compiled content reads at render time. */
export interface CompiledContentRuntimeProps {
  readonly components?: CompiledComponents<React.ElementType>;
}

export type CompiledContentComponent<Props extends object = Record<never, never>> =
  React.ComponentType<Readonly<Props> & CompiledContentRuntimeProps>;

export interface CompiledContentModule<Props extends object = Record<never, never>> {
  readonly default: CompiledContentComponent<Props>;
}
