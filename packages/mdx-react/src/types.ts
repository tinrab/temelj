import type {
  CodeBlockRenderInput,
  HtmlAttributeValue,
  MathRenderInput,
  StreamingPendingFencedCode,
  StreamingPendingMarkdownNode,
  StreamingJsx,
} from "@temelj/mdx";
import type React from "react";

import type { MdxRegistry } from "./registry.ts";

export type MdxLiteralPropValue = boolean | string;

export interface MdxComponentSource {
  readonly name: string;
  readonly start: number;
  readonly end: number;
}

export interface MdxElementComponentNode {
  readonly attributes: Readonly<Record<string, HtmlAttributeValue>>;
  readonly codeBlock?: CodeBlockRenderInput;
  readonly kind: "element";
  readonly name: string;
  readonly source?: MdxComponentSource;
}

export interface MdxJsxComponentNode {
  readonly attributes: Readonly<Record<string, boolean | string>>;
  readonly kind: "jsxFlowElement" | "jsxTextElement";
  readonly name: string;
  readonly source?: MdxComponentSource;
}

/** Plain component metadata that can cross a React Server Component boundary. */
export type MdxComponentNode = MdxElementComponentNode | MdxJsxComponentNode;

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

export type MdxCodeBlockComponentProps =
  | Readonly<{
      code: string;
      language?: string;
      meta?: string;
      node: StreamingPendingFencedCode;
      status: "pending";
    }>
  | Readonly<{
      code: string;
      language: string;
      meta?: string;
      node: MdxElementComponentNode;
      status: "complete";
    }>;

export interface MdxMarkdownComponents {
  readonly codeBlock?: React.ComponentType<MdxCodeBlockComponentProps>;
}

export type MathComponentProps = MathRenderInput;

export type MathComponent = React.ComponentType<MathComponentProps>;

export interface CompiledContentRuntimeProps {
  readonly registry?: MdxRegistry;
  readonly math?: MathComponent;
}

export type CompiledContentComponent<Props extends object = Record<never, never>> =
  React.ComponentType<Readonly<Props> & CompiledContentRuntimeProps>;

export interface CompiledContentModule<Props extends object = Record<never, never>> {
  readonly default: CompiledContentComponent<Props>;
}
