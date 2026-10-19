import { startsRegularExpression } from "../javascript.ts";

export type EmbeddedScannerResult =
  | Readonly<{ kind: "open" }>
  | Readonly<{ kind: "closed"; offset: number }>
  | Readonly<{ kind: "invalid"; offset: number }>;

export type JavaScriptScannerState =
  | "code"
  | "singleQuotedString"
  | "doubleQuotedString"
  | "template"
  | "lineComment"
  | "blockComment"
  | "regularExpression";

interface JavaScriptDelimiter {
  readonly character: ")" | "]" | "}";
  readonly resumesTemplate: boolean;
}

/** Retained lexical state shared by embedded expressions and strict JavaScript validation. */
export class JavaScriptScanner {
  readonly #delimiters: JavaScriptDelimiter[] = [];
  readonly #outer: "}" | undefined;
  #source = "";
  #characterClass = false;
  #escaped = false;
  #state: JavaScriptScannerState = "code";

  public constructor(outer?: "}") {
    this.#outer = outer;

    if (outer !== undefined) {
      this.#delimiters.push({ character: outer, resumesTemplate: false });
    }
  }

  public get state(): JavaScriptScannerState {
    return this.#state === "lineComment" ? "code" : this.#state;
  }

  public get incomplete(): boolean {
    return this.state !== "code" || this.#delimiters.length > 0;
  }

  public append(text: string): EmbeddedScannerResult {
    const start = this.#source.length;
    this.#source += text;

    for (let index = 0; index < text.length; index++) {
      const character = text[index];
      const next = text[index + 1];

      if (this.#state === "lineComment") {
        if (character === "\n" || character === "\r") {
          this.#state = "code";
        }

        continue;
      }

      if (this.#state === "blockComment") {
        if (character === "*" && next === "/") {
          this.#state = "code";
          index++;
        }

        continue;
      }

      if (this.#state === "singleQuotedString" || this.#state === "doubleQuotedString") {
        if (this.#escaped) {
          this.#escaped = false;
        } else if (character === "\\") {
          this.#escaped = true;
        } else if (
          (this.#state === "singleQuotedString" && character === "'") ||
          (this.#state === "doubleQuotedString" && character === '"')
        ) {
          this.#state = "code";
        }

        continue;
      }

      if (this.#state === "regularExpression") {
        if (this.#escaped) {
          this.#escaped = false;
        } else if (character === "\\") {
          this.#escaped = true;
        } else if (character === "[") {
          this.#characterClass = true;
        } else if (character === "]") {
          this.#characterClass = false;
        } else if (character === "/" && !this.#characterClass) {
          this.#state = "code";
        }

        continue;
      }

      if (this.#state === "template") {
        if (this.#escaped) {
          this.#escaped = false;
        } else if (character === "\\") {
          this.#escaped = true;
        } else if (character === "`") {
          this.#state = "code";
        } else if (character === "$" && next === "{") {
          this.#delimiters.push({ character: "}", resumesTemplate: true });
          this.#state = "code";
          index++;
        }

        continue;
      }

      if (character === "/" && next === "/") {
        this.#state = "lineComment";
        index++;
      } else if (character === "/" && next === "*") {
        this.#state = "blockComment";
        index++;
      } else if (
        character === "/" &&
        startsRegularExpression(
          (this.#outer === undefined ? "" : "(") + this.#source.slice(0, start + index),
        )
      ) {
        this.#state = "regularExpression";
        this.#characterClass = false;
      } else if (character === "'") {
        this.#state = "singleQuotedString";
      } else if (character === '"') {
        this.#state = "doubleQuotedString";
      } else if (character === "`") {
        this.#state = "template";
      } else if (character === "(") {
        this.#delimiters.push({ character: ")", resumesTemplate: false });
      } else if (character === "[") {
        this.#delimiters.push({ character: "]", resumesTemplate: false });
      } else if (character === "{") {
        this.#delimiters.push({ character: "}", resumesTemplate: false });
      } else if (character === ")" || character === "]" || character === "}") {
        const delimiter = this.#delimiters.at(-1);

        if (delimiter?.character !== character) {
          return { kind: "invalid", offset: index };
        }

        this.#delimiters.pop();

        if (this.#outer !== undefined && this.#delimiters.length === 0) {
          return { kind: "closed", offset: index + 1 };
        }

        if (delimiter.resumesTemplate) {
          this.#state = "template";
        }
      }
    }

    return { kind: "open" };
  }

  public clone(): JavaScriptScanner {
    const copy = new JavaScriptScanner(this.#outer);
    copy.#source = this.#source;
    copy.#characterClass = this.#characterClass;
    copy.#delimiters.splice(0, copy.#delimiters.length, ...this.#delimiters);
    copy.#escaped = this.#escaped;
    copy.#state = this.#state;

    return copy;
  }
}
