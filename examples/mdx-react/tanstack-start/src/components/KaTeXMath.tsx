import type { MathComponentProps } from "@temelj/mdx-react";
import type React from "react";

import katex from "katex";

const macros = Object.freeze({
  "\\RR": "\\mathbb{R}",
});

export function KaTeXMath({ source, style }: MathComponentProps): React.ReactNode {
  try {
    const html = katex.renderToString(source, {
      displayMode: style === "display",
      macros,
      throwOnError: false,
      trust: false,
    });
    return style === "display" ? (
      <div dangerouslySetInnerHTML={{ __html: html }} />
    ) : (
      <span dangerouslySetInnerHTML={{ __html: html }} />
    );
  } catch {
    return style === "display" ? (
      <pre>
        <code>{source}</code>
      </pre>
    ) : (
      <code>{source}</code>
    );
  }
}
