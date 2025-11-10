import type React from "react";

import { cn } from "../lib/utility";

type MdxCodeBlockProps = {
  "data-file-name"?: string;
} & React.HTMLAttributes<HTMLDivElement>;

export function MdxCodeBlock({
  className,
  children,
  "data-file-name": fileName,
  "data-language": language,
  "data-source-code": _sourceCode,
  "data-line-count": _lineCount,
  style: _style,
  ...restProps
}: MdxCodeBlockProps): React.ReactNode {
  return (
    <div className="relative rounded-sm" {...restProps}>
      {fileName ? (
        <div className="relative flex rounded-t-sm border-border border-t-2 border-r-2 border-l-2 p-2">
          <div className="ml-2 grow self-center text-muted-foreground text-sm">
            {fileName}
          </div>
        </div>
      ) : undefined}

      <div className="relative">
        <pre
          className={cn(
            "group relative flex overflow-auto rounded-sm border-2 border-border font-mono font-normal text-sm leading-relaxed [&_code]:bg-transparent",
            fileName ? "rounded-t-none" : "",
            "shiki",
            language ? `language-${language}` : "",
            className,
          )}
        >
          {children}
        </pre>
      </div>
    </div>
  );
}
