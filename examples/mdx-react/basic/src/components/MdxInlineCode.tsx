import type React from "react";

import { cn } from "../lib/utility";

type MdxInlineCodeProps = React.HTMLAttributes<HTMLSpanElement>;

export function MdxInlineCode({
  className,
  ...restProps
}: MdxInlineCodeProps): React.ReactNode {
  return (
    <code
      className={cn(
        className,
        "relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono font-normal text-sm",
      )}
      {...restProps}
    />
  );
}
