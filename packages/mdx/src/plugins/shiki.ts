import type { CodeToHastOptions, HighlighterGeneric } from "shiki/types";

import { isString, isBoolean, isNumber } from "@temelj/value";

import type { HtmlAttributeValue, HtmlAttributes, HtmlElementNode, HtmlNode } from "../html.ts";
import type { SyntaxHighlighter, SyntaxHighlightRequest } from "./syntax-highlight.ts";

import { codeLineSelected } from "./code-block-metadata.ts";

type ShikiHighlighter = Pick<
  HighlighterGeneric<string, string>,
  "codeToHast" | "getLoadedLanguages"
>;

type ShikiCodeToHastOptions<T> = T extends unknown ? Omit<T, "lang" | "meta" | "structure"> : never;

export type ShikiCodeOptions = ShikiCodeToHastOptions<CodeToHastOptions<string, string>>;

export type ShikiDataAttribute = "language" | "line-count" | "meta" | "source-code";

export type ShikiHighlighterOptions = ShikiCodeOptions &
  Readonly<{
    commandLineClassName?: string;
    fallbackLanguage?: string;
    highlightedLineClassName?: string;
    includeDataAttributes?: readonly ShikiDataAttribute[];
    languageAliases?: Readonly<Record<string, string>>;
    lineNumberClassName?: string;
    lineNumberWidthProperty?: string;
  }>;

const specialLanguages = new Set(["ansi", "plain", "plaintext", "text", "txt"]);

/** Adapts a caller-owned, preloaded Shiki highlighter to Temelj's code highlighter. */
export function createShikiHighlighter(
  highlighter: ShikiHighlighter,
  options: ShikiHighlighterOptions,
): SyntaxHighlighter {
  const {
    commandLineClassName = "line-command",
    fallbackLanguage,
    highlightedLineClassName = "highlighted",
    includeDataAttributes = [],
    languageAliases = {},
    lineNumberClassName = "line-number",
    lineNumberWidthProperty = "--line-number-width",
    ...codeOptions
  } = options;

  const loadedLanguages = new Set(
    highlighter.getLoadedLanguages().map((language) => language.toLowerCase()),
  );

  const aliases = new Map<string, string>();

  for (const [from, to] of Object.entries(languageAliases)) {
    aliases.set(from.toLowerCase(), to.toLowerCase());
  }

  return {
    kind: "synchronous",
    highlight(request: SyntaxHighlightRequest) {
      request.signal?.throwIfAborted();

      const language = resolveLanguage(
        request.language,
        aliases,
        fallbackLanguage,
        loadedLanguages,
      );

      if (language === undefined) {
        return;
      }

      const root = highlighter.codeToHast(request.code, {
        ...codeOptions,
        lang: language,
        meta: request.metadata.raw === undefined ? undefined : { __raw: request.metadata.raw },
        structure: "classic",
      });

      request.signal?.throwIfAborted();
      const pre = onlyPreElement(root.children);
      decorateCodeBlock(pre, request, {
        commandLineClassName,
        highlightedLineClassName,
        includeDataAttributes,
        lineNumberClassName,
        lineNumberWidthProperty,
      });

      return convertElement(pre);
    },
  };
}

interface DecorationOptions {
  readonly commandLineClassName: string;
  readonly highlightedLineClassName: string;
  readonly includeDataAttributes: readonly ShikiDataAttribute[];
  readonly lineNumberClassName: string;
  readonly lineNumberWidthProperty: string;
}

type ShikiRoot = ReturnType<ShikiHighlighter["codeToHast"]>;

type ShikiNode = ShikiRoot["children"][number];

type ShikiElement = Extract<ShikiNode, { type: "element" }>;

function resolveLanguage(
  authored: string,
  aliases: ReadonlyMap<string, string>,
  fallback: string | undefined,
  loaded: ReadonlySet<string>,
): string | undefined {
  const normalized = authored.toLowerCase();
  const requested = aliases.get(normalized) ?? normalized;

  if (isAvailableLanguage(requested, loaded)) {
    return requested;
  }

  const normalizedFallback = fallback?.toLowerCase();

  return normalizedFallback !== undefined && isAvailableLanguage(normalizedFallback, loaded)
    ? normalizedFallback
    : undefined;
}

function isAvailableLanguage(language: string, loaded: ReadonlySet<string>): boolean {
  return language.length > 0 && (loaded.has(language) || specialLanguages.has(language));
}

function onlyPreElement(children: ShikiRoot["children"]): ShikiElement {
  const first = children[0];

  if (children.length !== 1 || first?.type !== "element" || first.tagName !== "pre") {
    throw new TypeError("Shiki must return one classic pre element");
  }

  return first;
}

function decorateCodeBlock(
  pre: ShikiElement,
  request: SyntaxHighlightRequest,
  options: DecorationOptions,
): void {
  const code = pre.children.find(
    (node): node is ShikiElement => node.type === "element" && node.tagName === "code",
  );

  if (code === undefined) {
    throw new TypeError("Shiki pre element does not contain code");
  }

  addClass(code, `language-${request.language}`);

  const lines = code.children.filter(
    (node): node is ShikiElement => node.type === "element" && hasClass(node, "line"),
  );

  let largestLineNumber = 1;

  for (const [index, line] of lines.entries()) {
    const physicalLine = index + 1;
    const displayedLine = (request.metadata.lineNumbers?.start ?? 1) + index;
    line.properties["data-line"] = displayedLine;

    if (
      request.metadata.highlightedLines !== undefined &&
      codeLineSelected(request.metadata.highlightedLines, physicalLine)
    ) {
      addClass(line, options.highlightedLineClassName);
    }

    if (
      request.metadata.lineNumbers !== undefined &&
      codeLineSelected(request.metadata.lineNumbers.lines, physicalLine)
    ) {
      addClass(line, options.lineNumberClassName);
      largestLineNumber = Math.max(largestLineNumber, displayedLine);
    }

    if (
      request.metadata.commandLines !== undefined &&
      codeLineSelected(request.metadata.commandLines, physicalLine)
    ) {
      addClass(line, options.commandLineClassName);
    }
  }

  if (request.metadata.fileName !== undefined) {
    pre.properties["data-file-name"] = request.metadata.fileName;
  }

  if (request.metadata.lineNumbers !== undefined) {
    const declaration = `${options.lineNumberWidthProperty}:${String(largestLineNumber).length}ch`;
    const current = pre.properties.style;
    pre.properties.style =
      isString(current) && current.length > 0
        ? `${current.replace(/;?$/u, ";")}${declaration}`
        : declaration;
  }

  for (const attribute of options.includeDataAttributes) {
    switch (attribute) {
      case "language":
        pre.properties["data-language"] = request.language;
        break;
      case "line-count":
        pre.properties["data-line-count"] = lines.length;
        break;
      case "meta":
        if (request.metadata.raw !== undefined) {
          pre.properties["data-meta"] = request.metadata.raw;
        }

        break;
      case "source-code":
        pre.properties["data-source-code"] = request.code;
        break;
      default: {
        const _exhaustive: never = attribute;

        return _exhaustive;
      }
    }
  }
}

function hasClass(element: ShikiElement, name: string): boolean {
  const value = element.properties.class;

  return isString(value)
    ? value.split(/\s+/u).includes(name)
    : Array.isArray(value) && value.includes(name);
}

function addClass(element: ShikiElement, name: string): void {
  const value = element.properties.class;

  const classes = isString(value)
    ? value.split(/\s+/u).filter((item) => item.length > 0)
    : Array.isArray(value)
      ? value.filter((item): item is string => isString(item))
      : [];

  if (!classes.includes(name)) {
    classes.push(name);
  }

  element.properties.class = classes;
}

function convertNode(node: ShikiNode): HtmlNode {
  switch (node.type) {
    case "element":
      return convertElement(node);
    case "text":
      return { kind: "text", value: node.value };
    default:
      throw new TypeError(`Shiki returned unsupported ${node.type} content`);
  }
}

function convertElement(node: ShikiElement): HtmlElementNode {
  return {
    kind: "element",
    tagName: node.tagName,
    attributes: convertProperties(node.properties),
    children: node.children.map(convertNode),
  };
}

function convertProperties(properties: ShikiElement["properties"]): HtmlAttributes {
  const attributes: Record<string, HtmlAttributeValue> = {};

  for (const [name, value] of Object.entries(properties)) {
    if (value === null || value === undefined) {
      continue;
    }

    const attributeName = name === "className" ? "class" : name;

    if (isBoolean(value) || isNumber(value) || isString(value)) {
      attributes[attributeName] = value;
      continue;
    }

    if (Array.isArray(value) && value.every((item) => isNumber(item) || isString(item))) {
      attributes[attributeName] = value;
      continue;
    }

    throw new TypeError(`Shiki returned an unsupported ${JSON.stringify(name)} property`);
  }

  return attributes;
}
