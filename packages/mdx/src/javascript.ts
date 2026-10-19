import { Parser, type Options, type Node, type Program } from "acorn";
import acornJsx from "acorn-jsx";

const JavaScriptParser = Parser.extend(acornJsx());

const options: Options = {
  ecmaVersion: "latest",
  sourceType: "module",
};

// acorn-jsx adds expression kinds beyond Acorn's built-in Expression union.
export function parseJavaScriptExpression(source: string): Node {
  return JavaScriptParser.parseExpressionAt(source, 0, options);
}

export function parseJavaScriptProgram(source: string): Program {
  return JavaScriptParser.parse(source, options);
}

export function hasJavaScriptToken(source: string): boolean {
  return JavaScriptParser.tokenizer(source, options).getToken().type.label !== "eof";
}

/** Lets Acorn distinguish a regex literal from division using the preceding tokens. */
export function startsRegularExpression(prefix: string): boolean {
  const tokens = JavaScriptParser.tokenizer(`${prefix}/temelj/`, options);

  try {
    for (let token = tokens.getToken(); token.type.label !== "eof"; token = tokens.getToken()) {
      if (token.start === prefix.length) {
        return token.type.label === "regexp";
      }
    }
  } catch (cause) {
    if (!(cause instanceof SyntaxError)) {
      throw cause;
    }

    // Invalid prefixes are rejected by the strict parser after the boundary closes.
  }

  return false;
}
