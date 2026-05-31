import type { CheerioAPI } from "cheerio";

import * as cheerio from "cheerio";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

type TagNode = {
  type: "tag";
  tagName: string;
};

const BASE_URL = "https://ffmpeg.org";
const DOCS_DIR = join(import.meta.dirname, "../src/generated");

const OPTIONS_PAGES = [
  "ffmpeg.html",
  "ffplay.html",
  "ffprobe.html",
  "ffmpeg-utils.html",
  "ffmpeg-scaler.html",
  "ffmpeg-resampler.html",
  "ffmpeg-codecs.html",
  "ffmpeg-bitstream-filters.html",
  "ffmpeg-formats.html",
  "ffmpeg-protocols.html",
  "ffmpeg-devices.html",
  "ffmpeg-filters.html",
];

const TYPE_KEYWORDS = new Set([
  "integer",
  "float",
  "string",
  "flags",
  "boolean",
  "rational",
  "binary",
  "duration",
  "int64",
  "double",
  "list",
]);

const PAGE_CONTEXT: Record<string, string> = {
  ffmpeg: "tool",
  ffplay: "tool",
  ffprobe: "tool",
  "ffmpeg-utils": "utility",
  "ffmpeg-scaler": "scaler",
  "ffmpeg-resampler": "resampler",
  "ffmpeg-codecs": "codec",
  "ffmpeg-bitstream-filters": "bitstream_filter",
  "ffmpeg-formats": "format",
  "ffmpeg-protocols": "protocol",
  "ffmpeg-devices": "device",
  "ffmpeg-filters": "filter",
};

async function fetchHTML(url: string): Promise<string> {
  const headers = {
    "user-agent": "Mozilla/5.0 (compatible; ffmpeg-builder-scraper/1.0)",
  };

  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(30000), headers });
      if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
      return await resp.text();
    } catch (err) {
      lastError = err;
      if (attempt === 3) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Error fetching ${url}`);
}

function collectTextWithSeparator($: CheerioAPI, node: TagNode): string {
  const parts: string[] = [];
  for (const child of $(node as any)
    .contents()
    .toArray() as Array<unknown>) {
    const nodeChild = child as { type?: string; data?: string };
    if (nodeChild.type === "text") {
      const text = nodeChild.data?.trim() ?? "";
      if (text) parts.push(text);
    } else if (isTagNode(child)) {
      const nested = collectTextWithSeparator($, child);
      if (nested) parts.push(nested);
    }
  }
  return parts.join(" ");
}

function htmlDecode(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function isTagNode(node: unknown): node is TagNode {
  return (
    Boolean(node) &&
    typeof node === "object" &&
    (node as { type?: string }).type === "tag" &&
    typeof (node as { tagName?: unknown }).tagName === "string"
  );
}

function collectDdText($: CheerioAPI, ddTag: TagNode): string {
  const texts: string[] = [];
  for (const child of $(ddTag as any)
    .contents()
    .toArray() as Array<unknown>) {
    const nodeChild = child as { type?: string; data?: string };
    if (nodeChild.type === "text") {
      const t = nodeChild.data?.trim() ?? "";
      if (t) texts.push(htmlDecode(t));
    } else if (isTagNode(child) && child.tagName === "p") {
      texts.push(collectTextWithSeparator($, child));
    }
  }
  return htmlDecode(texts.join("\n")).trim();
}

function parseOptionTerm($: CheerioAPI, dtTag: TagNode): Record<string, any> | null {
  const samp = $(dtTag as any).find("samp");
  if (samp.length === 0) return null;

  let fullText = collectTextWithSeparator($, samp[0] as TagNode);
  fullText = htmlDecode(fullText);
  fullText = fullText.replace(/\s+/g, " ").trim();
  if (!fullText) return null;

  const categories: string[] = [];
  const catMatch = fullText.match(/\(([^()]+)\)\s*$/);
  if (catMatch) {
    categories.push(...catMatch[1].split(",").map((c) => c.trim()));
  }

  const textNoCat = fullText.replace(/\s*\([^()]*\)\s*$/, "").trim();

  const argMatch = textNoCat.match(/\[([^\]]*)\]/);
  const arguments_ = argMatch ? argMatch[1] : "";

  const textNoBrackets = textNoCat.replace(/\s*\[[^\]]*\]/g, "").trim();

  const words = textNoBrackets.split(/\s+/);

  let optType: string | null = null;
  let typeIdx: number | null = null;
  if (!textNoBrackets.startsWith("-")) {
    for (let i = words.length - 1; i >= 0; i--) {
      if (TYPE_KEYWORDS.has(words[i].toLowerCase())) {
        optType = words[i].toLowerCase();
        typeIdx = i;
        break;
      }
    }
  }

  let nameWords: string[];
  if (typeIdx !== null) {
    nameWords = [...words.slice(0, typeIdx), ...words.slice(typeIdx + 1)];
  } else {
    nameWords = words;
  }

  const textNoType = nameWords.join(" ");

  const parts = textNoType
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const primary = parts[0] || fullText;
  const aliases = parts.length > 1 ? parts.slice(1) : [];

  return {
    signature: fullText,
    name: primary,
    aliases,
    type: optType,
    categories,
    arguments: arguments_,
  };
}

function parsePossibleValues($: CheerioAPI, dlTag: TagNode): Array<Record<string, string>> {
  const values: Array<Record<string, string>> = [];
  const items = $(dlTag as any)
    .children("dt, dd")
    .toArray() as Array<unknown>;

  for (let i = 0; i < items.length; i++) {
    const item = items[i] as unknown;
    if (!isTagNode(item) || item.tagName !== "dt") continue;

    const valueName = collectTextWithSeparator($, item);
    let valueDesc = "";

    const next = i + 1 < items.length ? (items[i + 1] as unknown) : undefined;
    if (next && isTagNode(next) && next.tagName === "dd") {
      valueDesc = collectDdText($, next);
    }

    values.push({
      value: htmlDecode(valueName),
      description: valueDesc.replace(/µ/g, "u"),
    });
  }

  return values;
}

function parseOptionDl(
  $: CheerioAPI,
  dlTag: TagNode,
  pageName: string,
  section: string,
): Array<Record<string, any>> {
  const options: Array<Record<string, any>> = [];
  const items = $(dlTag as any)
    .children("dt, dd")
    .toArray() as Array<unknown>;

  let i = 0;
  while (i < items.length) {
    const item = items[i] as unknown;
    if (!isTagNode(item) || item.tagName !== "dt") {
      i++;
      continue;
    }

    const aliasesTerms: TagNode[] = [item];
    let j = i + 1;
    while (j < items.length) {
      const next = items[j] as unknown;
      if (!isTagNode(next) || next.tagName !== "dt") break;
      aliasesTerms.push(next);
      j++;
    }

    let ddTag: TagNode | null = null;
    if (j < items.length) {
      const next = items[j] as unknown;
      if (isTagNode(next) && next.tagName === "dd") {
        ddTag = next;
      }
    }

    let primaryInfo: Record<string, any> | null = null;
    const allNames: string[] = [];
    for (const dtTerm of aliasesTerms) {
      const info = parseOptionTerm($, dtTerm);
      if (info) {
        if (primaryInfo === null) {
          primaryInfo = info;
        }
        allNames.push(info["name"]);
      }
    }

    if (primaryInfo === null) {
      i = j;
      continue;
    }

    let desc = "";
    let possibleValues: Array<Record<string, string>> | null = null;

    if (ddTag) {
      desc = collectDdText($, ddTag);
      if (primaryInfo["name"] === "qrcode_width") {
        desc = desc.replace(/¸/g, "");
      }

      const nestedDl = $(ddTag as any).children("dl");
      if (nestedDl.length > 0) {
        possibleValues = parsePossibleValues($, nestedDl[0] as TagNode);
      }
    }

    let default_: string | null = null;
    if (desc) {
      const m = desc.match(/Default\s+(?:value\s+)?is\s+([^.\n]+)/i);
      if (m) {
        default_ = m[1].trim();
      }
    }

    let rangeInfo: Record<string, string> | null = null;
    if (desc) {
      const m = desc.match(
        /(?:Range|Must be)\s+(?:is\s+)?(?:between\s+)?([\d.-]+)\s+and\s+([\d.-]+)/i,
      );
      if (m) {
        rangeInfo = { min: m[1], max: m[2] };
      }
    }

    options.push({
      name: primaryInfo["name"],
      aliases: primaryInfo["aliases"],
      type: primaryInfo["type"],
      categories: primaryInfo["categories"],
      arguments: primaryInfo["arguments"],
      description: desc,
      default: default_,
      range: rangeInfo,
      possible_values: possibleValues,
      page: pageName,
      page_type: PAGE_CONTEXT[pageName] ?? "other",
      section,
    });

    i = j;
  }

  return options;
}

async function extractOptionsFromPage(pageName: string): Promise<Array<Record<string, any>>> {
  const pageId = pageName.replace(/\.html$/, "");
  const url = `${BASE_URL}/${pageName}`;

  const html = await fetchHTML(url);
  const $ = cheerio.load(html);
  let contentDiv = $("div.page-content.inset");
  if (contentDiv.length === 0) {
    contentDiv = $("#page-content-wrapper");
  }
  if (contentDiv.length === 0) return [];

  contentDiv.find("script, style, nav").remove();
  contentDiv.find("div.contents").remove();
  contentDiv.find('div[align="center"]').remove();

  const allOptions: Array<Record<string, any>> = [];
  let currentSection = "";

  for (const child of contentDiv.contents().toArray() as Array<unknown>) {
    if (!isTagNode(child)) continue;

    if (["h2", "h3", "h4"].includes(child.tagName)) {
      const text = $(child as any)
        .text()
        .trim();
      if (!text.includes("Table of Contents")) {
        currentSection = text;
      }
    } else if (child.tagName === "dl") {
      const dt = $(child as any).find("dt");
      if (dt.length > 0 && dt.find("samp").length > 0) {
        const opts = parseOptionDl($, child, pageId, currentSection);
        allOptions.push(...opts);
      }
    }
  }

  return allOptions;
}

async function main() {
  await mkdir(DOCS_DIR, { recursive: true });

  const allOptions: Array<Record<string, any>> = [];
  for (const page of OPTIONS_PAGES) {
    console.log(`  Extracting options from ${page}...`);
    const opts = await extractOptionsFromPage(page);
    allOptions.push(...opts);
    console.log(`    -> ${opts.length} options found`);
  }

  const meta = {
    generated: new Date().toISOString(),
    source: BASE_URL,
    pages_scraped: OPTIONS_PAGES.length,
    total_options: allOptions.length,
  };

  const outPath = join(DOCS_DIR, "ffmpeg-options.json");
  await writeFile(outPath, JSON.stringify({ meta, options: allOptions }, null, 2));
  console.log(`\nOptions JSON: ${allOptions.length} options written to ${outPath}`);
}

void main();
