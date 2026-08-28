import { createShikiHighlighter } from "@temelj/mdx/plugin";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import bash from "shiki/langs/bash.mjs";
import c from "shiki/langs/c.mjs";
import typescript from "shiki/langs/typescript.mjs";
import githubDark from "shiki/themes/github-dark.mjs";
import githubLight from "shiki/themes/github-light.mjs";

const highlighter = await createHighlighterCore({
  engine: createJavaScriptRegexEngine(),
  langs: [...c, ...typescript, ...bash],
  themes: [githubLight, githubDark],
});

export const shikiHighlighter = createShikiHighlighter(highlighter, {
  languageAliases: { cuda: "c", tsx: "typescript" },
  includeDataAttributes: ["language", "line-count", "source-code", "meta"],
  themes: { light: "github-light", dark: "github-dark" },
});
