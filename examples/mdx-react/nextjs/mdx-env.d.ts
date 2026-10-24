declare module "*.mdx" {
  import type { CompiledContentRuntimeProps } from "@temelj/mdx-react";
  import type { ReactNode } from "react";

  export default function MdxContent(props: CompiledContentRuntimeProps): ReactNode;
}
