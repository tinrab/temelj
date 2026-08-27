import { Parser, type Options } from "acorn";
import acornJsx from "acorn-jsx";

const JavaScriptParser = Parser.extend(acornJsx());

const options: Options = {
  ecmaVersion: "latest",
  sourceType: "module",
};

export function parseJavaScriptExpression(source: string) {
  return JavaScriptParser.parseExpressionAt(source, 0, options);
}

export function parseJavaScriptProgram(source: string) {
  return JavaScriptParser.parse(source, options);
}

export function hasJavaScriptToken(source: string): boolean {
  return JavaScriptParser.tokenizer(source, options).getToken().type.label !== "eof";
}
