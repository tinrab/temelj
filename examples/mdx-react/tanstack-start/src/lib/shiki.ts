import {
  HtmlElementNode,
  HtmlTextNode,
  type HtmlAttributeValue,
  type HtmlNode,
  type SyntaxHighlighter,
} from "@temelj/mdx";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import c from "shiki/langs/c.mjs";
import typescript from "shiki/langs/typescript.mjs";
import githubDark from "shiki/themes/github-dark.mjs";
import githubLight from "shiki/themes/github-light.mjs";

const highlighter = await createHighlighterCore({
  engine: createJavaScriptRegexEngine(),
  langs: [...c, ...typescript],
  themes: [githubLight, githubDark],
});

const themes = { light: "github-light", dark: "github-dark" } as const;

type ShikiNode = ReturnType<typeof highlighter.codeToHast>["children"][number];
type ShikiElement = Extract<ShikiNode, { type: "element" }>;

export const shikiHighlighter = {
  highlight({ code, language, signal }) {
    signal?.throwIfAborted();
    const root = highlighter.codeToHast(code, {
      lang: shikiLanguage(language),
      themes,
    });
    const pre = root.children[0];
    if (pre?.type !== "element" || pre.tagName !== "pre") {
      throw new Error("Shiki did not return a pre element");
    }
    signal?.throwIfAborted();
    return shikiElement(pre);
  },
} satisfies SyntaxHighlighter;

function shikiLanguage(language: string): "c" | "text" | "typescript" {
  switch (language.toLowerCase()) {
    case "c":
    case "cuda":
      return "c";
    case "ts":
    case "tsx":
    case "typescript":
      return "typescript";
    default:
      return "text";
  }
}

function shikiNode(node: ShikiNode): HtmlNode | undefined {
  switch (node.type) {
    case "element":
      return shikiElement(node);
    case "text":
      return new HtmlTextNode(node.value);
    default:
      return undefined;
  }
}

function shikiElement(node: ShikiElement): HtmlElementNode {
  const children: HtmlNode[] = [];
  for (const child of node.children) {
    const converted = shikiNode(child);
    if (converted !== undefined) {
      children.push(converted);
    }
  }
  return new HtmlElementNode(node.tagName, shikiAttributes(node.properties), children);
}

function shikiAttributes(
  properties: ShikiElement["properties"],
): Readonly<Record<string, HtmlAttributeValue>> {
  const attributes: Record<string, HtmlAttributeValue> = {};
  for (const [name, value] of Object.entries(properties)) {
    if (value === null || value === undefined) {
      continue;
    }
    const attributeName = name === "className" ? "class" : name;
    if (Array.isArray(value)) {
      attributes[attributeName] = value.filter(
        (item): item is number | string => typeof item === "number" || typeof item === "string",
      );
    } else {
      attributes[attributeName] = value;
    }
  }
  return attributes;
}
