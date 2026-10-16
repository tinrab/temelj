import { isNumber } from "@temelj/value";

import type { HtmlAttributes, HtmlAttributeValue, HtmlNode } from "./html.ts";

import { encodeNumericCharacterReference } from "./character-reference.ts";
import { InputError } from "./errors.ts";
import { htmlFallback, pendingFallback } from "./html.ts";

export interface HtmlFormatOptions {
  readonly closeSelfClosing?: boolean;
  readonly collapseEmptyAttributes?: boolean;
  readonly preferUnquotedAttributes?: boolean;
  readonly quote?: '"' | "'";
  readonly quoteSmart?: boolean;
  /** Raw HTML is escaped unless it is explicitly trusted. */
  readonly rawHtml?: "escape" | "trusted";
  readonly tightSelfClosing?: boolean;
  readonly voidElements?: readonly string[];
}

/** Serializes an HTML tree. JSX renders as its escaped authored fallback. */
export function formatHtml(node: HtmlNode, options: HtmlFormatOptions = {}): string {
  return new HtmlFormatter(options).format(node);
}

const tagNamePattern = /^[A-Za-z][A-Za-z0-9:-]*$/u;

const attributeNamePattern = /[\0\t\n\f\r "&'/<=>`]/gu;

const unquotedAttributePattern = /[\0\t\n\f\r "&'<=>`]/gu;

const doubleQuotedAttributePattern = /[\0"&]/gu;

const singleQuotedAttributePattern = /[\0'&]/gu;

const HTML_VOID_ELEMENTS: ReadonlySet<string> = new Set([
  "area",
  "base",
  "basefont",
  "bgsound",
  "link",
  "meta",
  "input",
  "embed",
  "param",
  "hr",
  "image",
  "img",
  "br",
  "wbr",
  "col",
  "source",
  "track",
  "keygen",
]);

class HtmlFormatter {
  private readonly options: HtmlFormatOptions;
  private readonly voids: ReadonlySet<string>;

  public constructor(options: HtmlFormatOptions) {
    this.options = options;
    this.voids =
      options.voidElements === undefined
        ? HTML_VOID_ELEMENTS
        : new Set(options.voidElements.map((name) => name.toLowerCase()));
  }

  public format(node: HtmlNode): string {
    switch (node.kind) {
      case "jsx":
      case "expression":
        return escapeHtmlText(node.fallback);
      case "text":
        return escapeHtmlText(node.value);
      case "raw":
        return this.options.rawHtml === "trusted" ? node.value : escapeHtmlText(node.value);
      case "comment":
        return formatComment(node.value);
      case "doctype":
        return "<!doctype html>";
      case "element":
        return this.element(node.tagName, node.attributes, this.children(node.children));
      case "root":
        return this.children(node.children);
      case "codeBlock":
      case "math":
      case "footnoteReference":
      case "footnoteSection":
        return this.format(htmlFallback(node));
      case "pending":
      case "unresolvedReference":
        return this.children(pendingFallback(node));
      default: {
        const exhaustive: never = node;

        return exhaustive;
      }
    }
  }

  public element(tagName: string, values: HtmlAttributes, content: string): string {
    if (!tagNamePattern.test(tagName)) {
      throw InputError.invalidHtmlTagName(tagName);
    }

    let opening = `<${tagName}`;

    for (const name in values) {
      if (Object.hasOwn(values, name)) {
        const attribute = this.attribute(name, values[name]);

        if (attribute.length > 0) {
          opening += ` ${attribute}`;
        }
      }
    }

    const isVoid = this.voids.has(tagName.toLowerCase()) && content.length === 0;

    if (isVoid) {
      if (this.options.closeSelfClosing !== true) {
        return `${opening}>`;
      }

      return `${opening}${this.options.tightSelfClosing === true ? "/" : " /"}>`;
    }

    return `${opening}>${content}</${tagName}>`;
  }

  private children(nodes: readonly HtmlNode[]): string {
    let content = "";

    for (const node of nodes) {
      content += this.format(node);
    }

    return content;
  }

  private attribute(name: string, value: HtmlAttributeValue): string {
    if (value === false || (isNumber(value) && Number.isNaN(value))) {
      return "";
    }

    const encodedName = escapeAttribute(name, attributeNamePattern);

    if (value === true) {
      return encodedName;
    }

    const serialized = Array.isArray(value) ? value.join(" ") : String(value);

    if (this.options.collapseEmptyAttributes === true && serialized.length === 0) {
      return encodedName;
    }

    if (
      this.options.preferUnquotedAttributes === true &&
      serialized.length > 0 &&
      !/[\0\t\n\f\r "'`=<>]/u.test(serialized)
    ) {
      return `${encodedName}=${escapeAttribute(serialized, unquotedAttributePattern)}`;
    }

    const preferred = this.options.quote ?? '"';
    const alternative = preferred === '"' ? "'" : '"';

    const quote =
      this.options.quoteSmart === true &&
      count(serialized, alternative) < count(serialized, preferred)
        ? alternative
        : preferred;

    const pattern = quote === '"' ? doubleQuotedAttributePattern : singleQuotedAttributePattern;

    return `${encodedName}=${quote}${escapeAttribute(serialized, pattern)}${quote}`;
  }
}

/** Internal formatter for immutable nodes owned by one stream. */
export class CachedHtmlFormatter extends HtmlFormatter {
  readonly #cache = new WeakMap<HtmlNode, string>();

  public override format(node: HtmlNode): string {
    const hit = this.#cache.get(node);

    if (hit !== undefined) {
      return hit;
    }

    const html = super.format(node);

    this.#cache.set(node, html);

    return html;
  }
}

function formatComment(value: string): string {
  return `<!--${value.replace(/^>|^->|<!--|-->|--!>|<!-$/gu, (match) => escapeComment(match))}-->`;
}

function escapeComment(value: string): string {
  return value.replace(/[<>]/gu, (character) => (character === "<" ? "&lt;" : "&gt;"));
}

function escapeHtmlText(value: string): string {
  return /[&<]/u.test(value)
    ? value.replace(/[&<]/gu, (character) => (character === "&" ? "&amp;" : "&lt;"))
    : value;
}

function escapeAttribute(value: string, pattern: RegExp): string {
  // Shared global patterns must start at the beginning for each attribute.
  pattern.lastIndex = 0;

  return pattern.test(value) ? value.replace(pattern, encodeCharacterReference) : value;
}

function encodeCharacterReference(character: string): string {
  return character === "\0"
    ? "&#xFFFD;"
    : encodeNumericCharacterReference(character.codePointAt(0) ?? 0);
}

function count(value: string, character: string): number {
  let result = 0;

  for (const candidate of value) {
    if (candidate === character) {
      result++;
    }
  }

  return result;
}
