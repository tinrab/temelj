import type { MdxContentComponents } from "@temelj/mdx-react";
import type React from "react";

import { MdxCodeBlock } from "./MdxCodeBlock.tsx";
import { MdxInlineCode } from "./MdxInlineCode.tsx";
import { cn } from "../lib/utility.ts";

export function getMdxComponents(): MdxContentComponents {
  return {
    h1: (props: React.HTMLAttributes<HTMLElement>) => (
      <h2 className="font-bold text-4xl mb-4" {...props} />
    ),
    h2: (props: React.HTMLAttributes<HTMLElement>) => (
      <h3 className="font-bold text-2xl mb-4" {...props} />
    ),
    p: (props: React.HTMLAttributes<HTMLElement>) => (
      <p className="mb-4" {...props} />
    ),

    pre: ({ className, ...restProps }: React.HTMLAttributes<HTMLElement>) => (
      <MdxCodeBlock className={cn("mb-4", className)} {...restProps} />
    ),
    code: (props: React.HTMLAttributes<HTMLElement>) => (
      <MdxInlineCode {...props} />
    ),
  };
}
