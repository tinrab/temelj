import type {
  HtmlElementNode,
  JsxFlowElementNode,
  JsxTextElementNode,
  MathRenderInput,
  StreamingPendingMarkdownNode,
  StreamingJsx,
} from "@temelj/mdx";
import type React from "react";

export type MdxLiteralPropValue = boolean | string;

export type MdxComponentNode = HtmlElementNode | JsxFlowElementNode | JsxTextElementNode;

export type MdxComponentProps<Node extends MdxComponentNode = MdxComponentNode> = Readonly<{
  node: Node;
}>;

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
    node: StreamingJsx;
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
  readonly node: StreamingJsx;
  readonly props: Readonly<Record<string, MdxLiteralPropValue>>;
}

export interface PendingMdxMarkdownProps {
  /** The node's complete safe default rendering. */
  readonly children: React.ReactNode;
  readonly node: StreamingPendingMarkdownNode;
}

export interface MdxPendingComponents {
  readonly jsx?: React.ComponentType<PendingMdxJsxFallbackProps>;
  readonly markdown?: React.ComponentType<PendingMdxMarkdownProps>;
}

export type CompiledMdxComponents = Readonly<Record<string, React.ElementType>>;
export type MathComponentProps = MathRenderInput;
export type MathComponent = React.ComponentType<MathComponentProps>;
export interface CompiledContentRuntimeProps {
  readonly components?: CompiledMdxComponents;
  readonly math?: MathComponent;
}

export type CompiledContentComponent<Props extends object = Record<never, never>> =
  React.ComponentType<Readonly<Props> & CompiledContentRuntimeProps>;

export interface CompiledContentModule<Props extends object = Record<never, never>> {
  readonly default: CompiledContentComponent<Props>;
  readonly [exportName: string]: unknown;
}
