import { toString as hastToString } from "hast-util-to-string";
import {
  type BundledLanguage,
  type BundledTheme,
  codeToHast,
  type CodeToHastOptions,
} from "shiki";
import { visit } from "unist-util-visit";
import {
  transformerNotationHighlight,
  type TransformerNotationHighlightOptions,
} from "@shikijs/transformers";
import { numericRangeContains } from "@temelj/iterator";

import type { HastElement, HastNode, PluginFactory } from "../../types.ts";
import { extractCodeMeta } from "./code-meta.ts";

type ShikiCodeToHastOptions = Partial<
  CodeToHastOptions<BundledLanguage, BundledTheme>
>;

/**
 * Options for {@linkcode syntaxHighlightPlugin}.
 */
export interface SyntaxHighlightPluginOptions {
  languageClassNamePrefix?: string;
  highlight?: {
    transformer?: TransformerNotationHighlightOptions;
  };
  lineNumbers?: {
    widthVariableName?: string;
    className?: string;
  };
  commandLine?: {
    className?: string;
  };
  shikiCodeToHastOptions?: ShikiCodeToHastOptions;
}

export function syntaxHighlightPlugin(
  options: SyntaxHighlightPluginOptions = {},
): PluginFactory {
  return async (tree: HastNode) => {
    const promises: Promise<void>[] = [];

    async function visitor(
      node: HastElement,
      index: number,
      parent: HastElement,
    ): Promise<void> {
      if (!parent || index === null || node.tagName !== "pre") {
        return;
      }

      const codeNode = node.children[0];
      if (
        !codeNode ||
        codeNode.type !== "element" ||
        codeNode.tagName !== "code" ||
        !codeNode.properties
      ) {
        return;
      }

      const lang = getNodeLanguage(codeNode);
      if (typeof lang !== "string") {
        return;
      }

      const meta = extractCodeMeta(codeNode);

      const sourceCode = hastToString(codeNode).trim();

      const hastOptions: CodeToHastOptions<BundledLanguage, BundledTheme> = {
        tokenizeTimeLimit: 10_000,
        lang,
        themes: {
          light: "github-light-default",
          dark: "github-dark-default",
        },
        ...(options.shikiCodeToHastOptions ?? {}),
      };
      if (hastOptions.transformers === undefined) {
        hastOptions.transformers = [];
      }

      if (options.highlight) {
        hastOptions.transformers.push(
          transformerNotationHighlight(options.highlight.transformer),
        );
      }

      hastOptions.transformers.push({
        code(node): void {
          if (options.languageClassNamePrefix) {
            this.addClassToHast(
              node,
              `${options.languageClassNamePrefix}${lang}`,
            );
          }

          let lineIndex = 0;
          for (
            const line of node.children.filter(
              (node: HastNode) => node.type === "element",
            ) as HastElement[]
          ) {
            line.properties["data-line"] = lineIndex + 1;

            if (options.highlight) {
              if (
                meta.highlight &&
                numericRangeContains(meta.highlight.lineRange, lineIndex)
              ) {
                this.addClassToHast(
                  line,
                  options.highlight.transformer?.classActiveLine ??
                    "highlighted",
                );
              }
            }

            if (
              options.lineNumbers &&
              meta.showLineNumbers &&
              (meta.showLineNumbers.lineRange.length === 0 ||
                numericRangeContains(
                  meta.showLineNumbers.lineRange,
                  lineIndex,
                ))
            ) {
              this.addClassToHast(
                line,
                options.lineNumbers.className ?? "line-number",
              );
            }

            if (
              options.commandLine &&
              meta.commandLine &&
              numericRangeContains(
                meta.commandLine.commandRange,
                lineIndex,
              )
            ) {
              this.addClassToHast(
                line,
                options.commandLine.className ?? "line-command",
              );
            }

            lineIndex++;
          }

          if (meta.showLineNumbers) {
            if (typeof node.properties.style !== "string") {
              node.properties.style = "";
            }
            node.properties.style += `--${
              options.lineNumbers?.widthVariableName ?? "line-number-width"
            }:${1 + Math.floor(Math.log10(this.lines.length))}ch;`;
          }
        },
      });

      const hast = await codeToHast(sourceCode, hastOptions);

      // Insert highlighted code into parent
      const hastPre = hast.children[0] as HastElement;
      parent.children.splice(index, 1, {
        ...hastPre,
        properties: {
          ...hastPre.properties,
          dataFileName: meta.fileName,
        },
      });
    }

    visit(
      tree,
      "element",
      (node: HastElement, index: number, parent: HastElement) => {
        promises.push(visitor(node, index, parent));
      },
    );

    await Promise.all(promises);

    return tree;
  };
}

function getNodeLanguage(node: HastElement): string | undefined {
  if (!Array.isArray(node.properties.className)) {
    return undefined;
  }
  const prefix = "language-";
  const language = node.properties.className.find(
    (name: string) => typeof name === "string" && name.startsWith(prefix),
  ) as string | undefined;
  if (typeof language === "string") {
    return language.slice(prefix.length);
  }
  return language;
}
