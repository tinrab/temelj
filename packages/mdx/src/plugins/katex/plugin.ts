import type { Element, ElementContent, Root } from "hast";
import type { Plugin } from "unified";

import { fromHtmlIsomorphic } from "hast-util-from-html-isomorphic";
import { toText } from "hast-util-to-text";
import katex, { type KatexOptions } from "katex";
import { SKIP, visitParents } from "unist-util-visit-parents";

import type { HastNode } from "../../types.ts";

/**
 * TeX math style applied to inline math.
 *
 * `"auto"` preserves the source and KaTeX's default style.
 */
export type InlineMathStyle = "auto" | "display" | "script" | "scriptscript" | "text";

type ExplicitInlineMathStyle = Exclude<InlineMathStyle, "auto">;

const mathClasses = {
  display: "math-display",
  inline: "math-inline",
  language: "language-math",
} as const;

const inlineMathStyleCommands: Readonly<Record<ExplicitInlineMathStyle, string>> = {
  display: String.raw`\displaystyle`,
  script: String.raw`\scriptstyle`,
  scriptscript: String.raw`\scriptscriptstyle`,
  text: String.raw`\textstyle`,
} as const;

type KatexRenderOptions = Omit<KatexOptions, "displayMode" | "throwOnError">;

/**
 * KaTeX options controlled by callers. Rendering mode and error handling are
 * inferred and enforced by the plugin.
 */
export type KatexPluginOptions = KatexRenderOptions & {
  /**
   * TeX math style applied to inline-math nodes.
   *
   * Display and fenced math are not affected.
   *
   * @default "auto"
   */
  inlineMathStyle?: InlineMathStyle;
};

/**
 * Renders HAST elements marked as inline, display, or fenced-code math with
 * KaTeX.
 */
export const katexPlugin: Plugin<[Readonly<KatexPluginOptions>?], HastNode, HastNode> = (
  options = {},
) => {
  const { inlineMathStyle = "auto", ...katexOptions } = options;

  return (tree, file) => {
    visitParents(tree as Root, "element", (element, ancestors) => {
      const classes = Array.isArray(element.properties.className)
        ? element.properties.className
        : [];
      const isLanguageMath = classes.includes(mathClasses.language);
      const isDisplayMath = classes.includes(mathClasses.display);
      const isInlineMath = classes.includes(mathClasses.inline);

      if (!isLanguageMath && !isDisplayMath && !isInlineMath) {
        return;
      }

      let scope: Element = element;
      let parent = ancestors.at(-1);
      let displayMode = isDisplayMath;

      if (
        element.tagName === "code" &&
        isLanguageMath &&
        parent?.type === "element" &&
        parent.tagName === "pre"
      ) {
        scope = parent;
        parent = ancestors.at(-2);
        displayMode = true;
      }

      if (parent === undefined || (parent.type !== "element" && parent.type !== "root")) {
        return;
      }

      const value = toText(scope, { whitespace: "pre" });
      const renderedValue =
        isInlineMath && !displayMode ? applyInlineMathStyle(value, inlineMathStyle) : value;
      let result: ElementContent[];

      try {
        result = renderMath(renderedValue, katexOptions, displayMode);
      } catch (error) {
        const cause = getOriginalRenderError(value, katexOptions, displayMode, error);

        file.message("Could not render math with KaTeX", {
          ancestors: [...ancestors, element],
          cause,
          place: element.position,
          ruleId: cause.name.toLowerCase(),
          source: "rehype-katex",
        });

        try {
          result = renderMath(value, { ...katexOptions, strict: "ignore" }, displayMode, false);
        } catch {
          result = [
            {
              type: "element",
              tagName: "span",
              properties: {
                className: ["katex-error"],
                style: `color:${katexOptions.errorColor ?? "#cc0000"}`,
                title: String(cause),
              },
              children: [{ type: "text", value }],
            },
          ];
        }
      }

      const index = parent.children.indexOf(scope);
      if (index !== -1) {
        parent.children.splice(index, 1, ...result);
      }

      return SKIP;
    });

    return tree;
  };
};

function getOriginalRenderError(
  value: string,
  options: Readonly<KatexRenderOptions>,
  displayMode: boolean,
  styledError: unknown,
): Error {
  try {
    katex.renderToString(value, {
      ...options,
      displayMode,
      throwOnError: true,
    });
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }

  return styledError instanceof Error ? styledError : new Error(String(styledError));
}

function applyInlineMathStyle(value: string, style: InlineMathStyle): string {
  if (style === "auto") {
    return value;
  }

  return `{${inlineMathStyleCommands[style]} ${value}}`;
}

function renderMath(
  value: string,
  options: Readonly<KatexRenderOptions>,
  displayMode: boolean,
  throwOnError = true,
): ElementContent[] {
  const html = katex.renderToString(value, {
    ...options,
    displayMode,
    throwOnError,
  });
  const root = fromHtmlIsomorphic(html, { fragment: true });

  // KaTeX emits an HTML fragment and therefore cannot produce doctypes.
  return root.children as ElementContent[];
}
