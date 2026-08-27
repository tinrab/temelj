import type React from "react";

import { cn } from "../lib/utils";

type InlineCodeProps = React.HTMLAttributes<HTMLSpanElement>;

export function InlineCode({ className, ...restProps }: InlineCodeProps): React.ReactNode {
  return (
    <code
      className={cn(
        className,
        "bg-muted relative rounded px-[0.3rem] py-[0.2rem] font-mono text-sm font-normal",
      )}
      {...restProps}
    />
  );
}
