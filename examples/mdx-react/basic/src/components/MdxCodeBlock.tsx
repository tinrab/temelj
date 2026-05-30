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
        <div className="border-border relative flex rounded-t-sm border-t-2 border-r-2 border-l-2 p-2">
          <div className="text-muted-foreground ml-2 grow self-center text-sm">{fileName}</div>
        </div>
      ) : undefined}

      <div className="relative">
        <pre
          className={cn(
            "group border-border relative flex overflow-auto rounded-sm border-2 font-mono text-sm leading-relaxed font-normal [&_code]:bg-transparent",
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
