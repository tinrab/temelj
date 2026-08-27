import type { HtmlAttributeValue, HtmlElementNode, HtmlFormatOptions, HtmlNode } from "./html.ts";

import { encodeNumericCharacterReference } from "./utility.ts";

export function formatHtml(node: HtmlNode, options: HtmlFormatOptions = {}): string {
  return new HtmlFormatter(options).format(node);
}

class HtmlFormatter {
  private readonly options: HtmlFormatOptions;
  private readonly voids: ReadonlySet<string>;

  public constructor(options: HtmlFormatOptions) {
    this.options = { ...options };
    this.voids = new Set(
      (options.voidElements ?? htmlVoidElements).map((name) => name.toLowerCase()),
    );
  }

  public format(node: HtmlNode): string {
    switch (node.kind) {
      case "jsx":
      case "text":
        return escapeHtmlText(node.value);
      case "raw":
        return this.options.rawHtml === "trusted" ? node.value : escapeHtmlText(node.value);
      case "comment":
        return formatComment(node.value);
      case "doctype":
        return "<!doctype html>";
      case "element":
        return this.element(node);
      case "fragment":
      case "document":
        return node.children.map((child) => this.format(child)).join("");
      default: {
        const exhaustive: never = node;
        return exhaustive;
      }
    }
  }

  private element(node: HtmlElementNode): string {
    const attributes = Object.entries(node.attributes)
      .map(([name, value]) => this.attribute(name, value))
      .filter((value) => value.length > 0)
      .join(" ");
    const opening = `<${node.tagName}${attributes.length === 0 ? "" : ` ${attributes}`}`;
    const isVoid = this.voids.has(node.tagName.toLowerCase()) && node.children.length === 0;
    if (isVoid) {
      if (this.options.closeSelfClosing !== true) {
        return `${opening}>`;
      }
      return `${opening}${this.options.tightSelfClosing === true ? "/" : " /"}>`;
    }
    const content = node.children.map((child) => this.format(child)).join("");
    return `${opening}>${content}</${node.tagName}>`;
  }

  private attribute(name: string, value: HtmlAttributeValue): string {
    if (value === false || (typeof value === "number" && Number.isNaN(value))) {
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

const htmlVoidElements: readonly string[] = [
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
