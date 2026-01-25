import {
  type TransformerNotationHighlightOptions,
  transformerNotationHighlight,
} from "@shikijs/transformers";
import { numericRangeContains } from "@temelj/iterator";
import type { Properties } from "hast";
import { toString as hastToString } from "hast-util-to-string";
import {
  type BundledLanguage,
  type BundledTheme,
  type CodeToHastOptions,
  codeToHast,
  ShikiError,
} from "shiki";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";

import type { HastElement, HastNode } from "../../types";
import { extractCodeMeta } from "./code-meta";

type ShikiHastOptions = Partial<
  CodeToHastOptions<BundledLanguage, BundledTheme>
>;

type SyntaxDataAttribute = "source-code" | "language" | "line-count";

/**
 * Options for {@linkcode syntaxHighlightPlugin}.
 */
export interface SyntaxHighlightPluginOptions {
  /**
   * Include these data attributes on the `<pre>` element.
   * These might be useful to have when building custom code components.
   */
  includeDataAttributes?: SyntaxDataAttribute[];

  /**
   * Options for the highlight transformer.
   */
  highlight?: {
    transformer?: TransformerNotationHighlightOptions;
  };

  /**
   * Options for line numbers.
   */
  lineNumbers?: {
    /**
     * The name of the variable that contains the line number width.
     * This is used for padding the line numbers so that they align.
     */
    widthVariableName?: string;
    /**
     * A class name to be added to the line numbers.
     */
    className?: string;
  };

  /**
   * Options for command line.
   */
  commandLine?: {
    /**
     * A class name to be added to the prompt line.
     */
    className?: string;
  };

  /**
   * Extra options for the Shiki hast transformer.
   */
  shikiHastOptions?: ShikiHastOptions;
}

/**
 * A plugin that highlights code blocks using Shiki.
 */
export const syntaxHighlightPlugin: Plugin<
  [SyntaxHighlightPluginOptions?],
  HastNode,
  HastNode
> = (options: SyntaxHighlightPluginOptions = {}) => {
  return async (tree) => {
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
        ...(options.shikiHastOptions ?? {}),
      };
      if (hastOptions.transformers === undefined) {
        hastOptions.transformers = [];
      }

      if (options.highlight) {
        hastOptions.transformers.push(
          transformerNotationHighlight({
            ...(options.highlight.transformer ?? {}),
            matchAlgorithm: "v3",
          }),
        );
      }

      let lineCount = 0;
      hastOptions.transformers.push({
        code(node): void {
          let lineIndex = 0;
          for (const line of node.children.filter(
            (node: HastNode) => node.type === "element",
          ) as HastElement[]) {
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
                numericRangeContains(meta.showLineNumbers.lineRange, lineIndex))
            ) {
              this.addClassToHast(
                line,
                options.lineNumbers.className ?? "line-number",
              );
            }

            if (
              options.commandLine &&
              meta.commandLine &&
              (meta.commandLine.commandRange.length === 0 ||
                numericRangeContains(meta.commandLine.commandRange, lineIndex))
            ) {
              this.addClassToHast(
                line,
                options.commandLine.className ?? "line-command",
              );
            }

            lineIndex++;
          }

          lineCount = lineIndex;

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

      try {
        const hast = await codeToHast(sourceCode, hastOptions);

        // Insert highlighted code into parent
        const hastPre = hast.children[0] as HastElement;

        const properties: Properties = {
          ...hastPre.properties,
          dataFileName: meta.fileName,
        };
        if (options.includeDataAttributes) {
          if (options.includeDataAttributes.includes("language")) {
            properties.dataLanguage = lang;
          }
          if (options.includeDataAttributes.includes("source-code")) {
            properties.dataSourceCode = sourceCode;
          }
          if (options.includeDataAttributes.includes("line-count")) {
            properties.dataLineCount = lineCount;
          }
        }

        parent.children.splice(index, 1, {
          ...hastPre,
          properties,
        });
      } catch (error) {
        if (error instanceof ShikiError) {
          if (
            error.message.includes(
              "Language `math` is not included in this bundle",
            )
          ) {
            // Skip if the block is math block.
            return;
          }
        }
        throw error;
      }
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
};

function getNodeLanguage(node: HastElement): string | undefined {
  if (!Array.isArray(node.properties.className)) {
    return undefined;
  }
  const prefix = "language-";
  const language = node.properties.className.find(
    (name) => typeof name === "string" && name.startsWith(prefix),
  ) as string | undefined;
  if (typeof language === "string") {
    return language.slice(prefix.length);
  }
  return language;
}
