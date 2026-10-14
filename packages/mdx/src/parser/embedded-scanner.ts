export type EmbeddedScannerResult =
  | Readonly<{ kind: "open" }>
  | Readonly<{ kind: "closed"; offset: number }>
  | Readonly<{ kind: "invalid"; offset: number }>;

type JavaScriptState =
  | "code"
  | "singleQuotedString"
  | "doubleQuotedString"
  | "template"
  | "lineComment"
  | "blockComment";

interface JavaScriptDelimiter {
  readonly character: ")" | "]" | "}";
  readonly resumesTemplate: boolean;
}

/** Retained lexical boundary state for an outer MDX `{...}` expression. */
export class ExpressionBoundaryScanner {
  readonly #delimiters: JavaScriptDelimiter[] = [{ character: "}", resumesTemplate: false }];
  #escaped = false;
  #state: JavaScriptState = "code";

  public append(text: string): EmbeddedScannerResult {
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

        if (this.#delimiters.length === 0) {
          return { kind: "closed", offset: index + 1 };
        }

        if (delimiter.resumesTemplate) {
          this.#state = "template";
        }
      }
    }

    return { kind: "open" };
  }

  public clone(): ExpressionBoundaryScanner {
    const copy = new ExpressionBoundaryScanner();
    copy.#delimiters.splice(0, copy.#delimiters.length, ...this.#delimiters);
    copy.#escaped = this.#escaped;
    copy.#state = this.#state;

    return copy;
  }
}

type JsxState = "children" | "tag" | "singleQuotedAttribute" | "doubleQuotedAttribute";

/** Retained structural boundary state for one MDX JSX flow element or fragment. */
export class JsxBoundaryScanner {
  readonly #elements: string[] = [];
  #closing = false;
  #expression: ExpressionBoundaryScanner | undefined;
  #name = "";
  #readingName = false;
  #rootOpened = false;
  #state: JsxState = "children";
  #opening = new JsxOpeningScanner();

  public append(text: string): EmbeddedScannerResult {
    this.#opening.append(text);

    for (let index = 0; index < text.length; index++) {
      const character = text[index];

      if (this.#expression !== undefined) {
        const expression = this.#expression.append(text.slice(index));

        if (expression.kind === "invalid") {
          return { kind: "invalid", offset: index + expression.offset };
        }

        if (expression.kind === "open") {
          return expression;
        }

        index += expression.offset - 1;
        this.#expression = undefined;
        continue;
      }

      if (this.#state === "singleQuotedAttribute" || this.#state === "doubleQuotedAttribute") {
        if (
          (this.#state === "singleQuotedAttribute" && character === "'") ||
          (this.#state === "doubleQuotedAttribute" && character === '"')
        ) {
          this.#state = "tag";
        }

        continue;
      }

      if (this.#state === "children") {
        if (character === "{") {
          this.#expression = new ExpressionBoundaryScanner();
        } else if (character === "<") {
          this.#state = "tag";
          this.#closing = text[index + 1] === "/";
          this.#name = "";
          this.#readingName = true;

          if (this.#closing) {
            index++;
          }
        }

        continue;
      }

      if (character === "'" || character === '"') {
        this.#state = character === "'" ? "singleQuotedAttribute" : "doubleQuotedAttribute";
      } else if (character === "{") {
        this.#expression = new ExpressionBoundaryScanner();
      } else if (character === ">") {
        const selfClosing = text[index - 1] === "/";

        if (this.#closing) {
          const expected = this.#elements.pop();

          if (expected === undefined || expected !== this.#name) {
            return { kind: "invalid", offset: index };
          }
        } else if (!selfClosing) {
          this.#elements.push(this.#name);
        }

        this.#rootOpened = true;
        this.#state = "children";

        if (this.#elements.length === 0) {
          return { kind: "closed", offset: index + 1 };
        }
      } else if (this.#readingName && isJsxNameCharacter(character)) {
        this.#name += character;
      } else if ((character === " " || character === "\t") && this.#name !== "") {
        this.#readingName = false;
      } else if (this.#name === "" && character !== " " && character !== "\t") {
        return { kind: "invalid", offset: index };
      }
    }

    return { kind: "open" };
  }

  public clone(): JsxBoundaryScanner {
    const copy = new JsxBoundaryScanner();
    copy.#elements.push(...this.#elements);
    copy.#closing = this.#closing;
    copy.#expression = this.#expression?.clone();
    copy.#name = this.#name;
    copy.#readingName = this.#readingName;
    copy.#rootOpened = this.#rootOpened;
    copy.#state = this.#state;
    copy.#opening = this.#opening.clone();

    return copy;
  }

  public opening(): CommittedJsxOpening {
    return this.#opening.snapshot();
  }

  public get validPrefix(): boolean {
    return this.#rootOpened || this.#state === "tag";
  }
}

function isJsxNameCharacter(character: string): boolean {
  return /[\w:.-]/u.test(character);
}

export interface CommittedJsxOpening {
  readonly name: string | undefined;
  readonly attributes: Readonly<Record<string, boolean | string>>;
  readonly safe: boolean;
  readonly end: number | undefined;
}

type OpeningState =
  | "start"
  | "name"
  | "between"
  | "attribute"
  | "afterAttribute"
  | "value"
  | "single"
  | "double"
  | "slash"
  | "closed"
  | "unsafe";

/** Only publishes attributes after their lexical boundary is unambiguous. */
// Props that renderers own; authored values would replace them.
const reservedJsxProps: ReadonlySet<string> = new Set(["children", "key", "node", "ref"]);

class JsxOpeningScanner {
  #state: OpeningState = "start";
  #name = "";
  #committedName: string | undefined;
  #attribute = "";
  #value = "";
  #attributes = new Map<string, boolean | string>();
  #offset = 0;
  #end: number | undefined;

  public append(text: string): void {
    for (const character of text) {
      this.#offset += character.length;
      this.character(character);
    }
  }

  private character(character: string): void {
    if (this.#state === "unsafe") {
      return;
    }

    // Children never execute while pending, so they cannot affect opening safety.
    if (this.#state === "closed") {
      return;
    }

    if (this.#state === "single" || this.#state === "double") {
      if (character === (this.#state === "single" ? "'" : '"')) {
        this.#attributes.set(this.#attribute, this.#value);
        this.#state = "between";
      } else {
        this.#value += character;
      }

      return;
    }

    if (this.#state === "start") {
      this.#state = character === "<" ? "name" : "unsafe";

      return;
    }

    if (this.#state === "name") {
      if (/[$\w:.-]/u.test(character)) {
        this.#name += character;

        return;
      }

      if (this.#name.length === 0 || !/[\s/>]/u.test(character)) {
        this.#state = "unsafe";

        return;
      }

      this.#committedName = this.#name;
      this.#state = "between";
    }

    if (this.#state === "attribute") {
      if (/[$\w:.-]/u.test(character)) {
        this.#attribute += character;

        return;
      }

      if (reservedJsxProps.has(this.#attribute)) {
        this.#state = "unsafe";

        return;
      }

      this.#state = "afterAttribute";
    }

    if (this.#state === "afterAttribute") {
      if (/\s/u.test(character)) {
        return;
      }

      if (character === "=") {
        this.#state = "value";

        return;
      }

      this.#attributes.set(this.#attribute, true);
      this.#state = "between";
    }

    if (this.#state === "value") {
      if (/\s/u.test(character)) {
        return;
      }

      this.#value = "";
      this.#state = character === "'" ? "single" : character === '"' ? "double" : "unsafe";

      return;
    }

    if (character === ">") {
      this.#end = this.#offset;
      this.#state = "closed";
    } else if (this.#state === "slash") {
      this.#state = "unsafe";
    } else if (character === "/") {
      this.#state = "slash";
    } else if (!/\s/u.test(character)) {
      this.#attribute = character;
      this.#state = /[$A-Za-z_]/u.test(character) ? "attribute" : "unsafe";
    }
  }

  public snapshot(): CommittedJsxOpening {
    return Object.freeze({
      name: this.#committedName,
      attributes: Object.freeze(Object.fromEntries(this.#attributes)),
      safe:
        this.#state !== "unsafe" &&
        !(this.#state === "attribute" && reservedJsxProps.has(this.#attribute)),
      end: this.#end,
    });
  }

  public clone(): JsxOpeningScanner {
    const copy = new JsxOpeningScanner();
    copy.#state = this.#state;
    copy.#name = this.#name;
    copy.#committedName = this.#committedName;
    copy.#attribute = this.#attribute;
    copy.#value = this.#value;
    copy.#attributes = new Map(this.#attributes);
    copy.#offset = this.#offset;
    copy.#end = this.#end;

    return copy;
  }
}
