import { isNumber } from "@temelj/value";

import type { HtmlAttributes, HtmlAttributeValue, HtmlNode } from "./html.ts";

import { InputError } from "./errors.ts";
import { htmlFallback } from "./html.ts";
import { encodeNumericCharacterReference } from "./utility.ts";

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

/** Serializes already-rendered children using the same element rules as strict HTML. */
export function formatHtmlElement(
  tagName: string,
  attributes: HtmlAttributes,
  content: string,
): string {
  return new HtmlFormatter({}).element(tagName, attributes, content);
}

const tagNamePattern = /^[A-Za-z][A-Za-z0-9:-]*$/u;

const HTML_VOID_ELEMENTS: readonly string[] = [
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
];

class HtmlFormatter {
  private readonly options: HtmlFormatOptions;
  private readonly voids: ReadonlySet<string>;

  public constructor(options: HtmlFormatOptions) {
    this.options = { ...options };
    this.voids = new Set(
      (options.voidElements ?? HTML_VOID_ELEMENTS).map((name) => name.toLowerCase()),
    );
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
        return this.element(
          node.tagName,
          node.attributes,
          node.children.map((child) => this.format(child)).join(""),
        );
      case "root":
        return node.children.map((child) => this.format(child)).join("");
      case "codeBlock":
      case "math":
      case "footnoteReference":
      case "footnoteSection":
        return this.format(htmlFallback(node));
      default: {
        const exhaustive: never = node;

        return exhaustive;
      }
    }
  }

  public element(tagName: string, values: HtmlAttributes, content: string): string {
    if (!tagNamePattern.test(tagName)) {
      InputError.invalidHtmlTagName(tagName);
    }

    const attributes = Object.entries(values)
      .map(([name, value]) => this.attribute(name, value))
      .filter((value) => value.length > 0)
      .join(" ");

    const opening = `<${tagName}${attributes.length === 0 ? "" : ` ${attributes}`}`;
    const isVoid = this.voids.has(tagName.toLowerCase()) && content.length === 0;

    if (isVoid) {
      if (this.options.closeSelfClosing !== true) {
        return `${opening}>`;
      }

      return `${opening}${this.options.tightSelfClosing === true ? "/" : " /"}>`;
    }

    return `${opening}>${content}</${tagName}>`;
  }

  private attribute(name: string, value: HtmlAttributeValue): string {
    if (value === false || (isNumber(value) && Number.isNaN(value))) {
      return "";
    }

    const encodedName = escapeAttributeName(name);

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
      return `${encodedName}=${escapeUnquotedAttribute(serialized)}`;
    }

    const preferred = this.options.quote ?? '"';
    const alternative = preferred === '"' ? "'" : '"';

    const quote =
      this.options.quoteSmart === true &&
      count(serialized, alternative) < count(serialized, preferred)
        ? alternative
        : preferred;

    return `${encodedName}=${quote}${escapeQuotedAttribute(serialized, quote)}${quote}`;
  }
}

function formatComment(value: string): string {
  return `<!--${value.replace(/^>|^->|<!--|-->|--!>|<!-$/gu, (match) => escapeComment(match))}-->`;
}

function escapeComment(value: string): string {
  return value.replace(/[<>]/gu, (character) => (character === "<" ? "&lt;" : "&gt;"));
}

function escapeHtmlText(value: string): string {
  return value.replace(/[&<]/gu, (character) => (character === "&" ? "&amp;" : "&lt;"));
}

function escapeAttributeName(value: string): string {
  return value.replace(/[\0\t\n\f\r "&'/<=>`]/gu, encodeCharacterReference);
}

function escapeUnquotedAttribute(value: string): string {
  return value.replace(/[\0\t\n\f\r "&'<=>`]/gu, encodeCharacterReference);
}

function escapeQuotedAttribute(value: string, quote: '"' | "'"): string {
  return value.replace(quote === '"' ? /[\0"&]/gu : /[\0'&]/gu, encodeCharacterReference);
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
