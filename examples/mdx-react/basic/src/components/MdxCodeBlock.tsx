import type React from "react";

import { cn } from "../lib/utility.ts";

type MdxCodeBlockProps = {
  "data-file-name"?: string;
} & React.HTMLAttributes<HTMLDivElement>;

export function MdxCodeBlock({
  className,
  style,
  children,
  "data-file-name": fileName,
  ...restProps
}: MdxCodeBlockProps): React.ReactNode {
  return (
    <div className="relative rounded-sm" {...restProps}>
      {fileName
        ? (
          <div className="relative flex rounded-t-sm border-neutral-300 border-b-2 bg-neutral-200 p-2 dark:border-neutral-700 dark:bg-neutral-800">
            <div className="grow self-center text-muted-foreground text-sm">
              {fileName}
            </div>
          </div>
        )
        : undefined}

      <div className="relative">
        <pre
          className={cn(
            "ligatures-none flex overflow-auto rounded-sm font-mono font-normal text-sm leading-relaxed [&_code]:bg-transparent",
            "shiki",
            className,
          )}
          style={style}
        >
					{children}
        </pre>
      </div>
    </div>
  );
}
