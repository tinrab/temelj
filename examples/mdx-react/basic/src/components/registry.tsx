import type { MdxContentComponents } from "@temelj/mdx-react";
import type React from "react";

import { cn } from "../lib/utility";
import { MdxCodeBlock } from "./MdxCodeBlock";
import { MdxInlineCode } from "./MdxInlineCode";

export function getMdxComponents(): MdxContentComponents {
  return {
    h1: (props: React.HTMLAttributes<HTMLElement>) => (
      <h2 className="mb-4 font-bold text-4xl" {...props} />
    ),
    h2: (props: React.HTMLAttributes<HTMLElement>) => (
      <h3 className="mb-4 font-bold text-2xl" {...props} />
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
