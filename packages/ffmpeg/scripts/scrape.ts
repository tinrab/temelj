import type { CheerioAPI } from "cheerio";

import * as cheerio from "cheerio";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

type CheerioRoot = ReturnType<CheerioAPI["root"]>;

type DomNode = ReturnType<CheerioRoot["contents"]>[number];

type TagNode = ReturnType<CheerioRoot["children"]>[number];

interface OptionTerm {
  signature: string;
  name: string;
  aliases: string[];
  type: string | null;
  categories: string[];
  arguments: string;
}

interface PossibleValue {
  value: string;
  description: string;
}

interface ScrapedOption extends Omit<OptionTerm, "signature"> {
  description: string;
  default: string | null;
  range: { min: string; max: string } | null;
  possible_values: PossibleValue[] | null;
  page: string;
  page_type: string;
  section: string;
}

class FFmpegScrapeError extends Error {
  constructor(message: string, context?: Function) {
    super(message);
    this.name = "FFmpegScrapeError";

    if (Error.captureStackTrace !== undefined) {
      Error.captureStackTrace(this, context ?? this.constructor);
    }
  }

  static fetchFailed(this: void, url: string, status: number): never {
    throw new FFmpegScrapeError(`HTTP ${status} fetching ${url}`, FFmpegScrapeError.fetchFailed);
  }

  static createFetchError(this: void, url: string): FFmpegScrapeError {
    return new FFmpegScrapeError(`Error fetching ${url}`, FFmpegScrapeError.createFetchError);
  }
}

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

const PAGE_CONTEXT = new Map<string, string>(
  Object.entries({
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
  }),
);

async function fetchHTML(url: string): Promise<string> {
  const headers = {
    "user-agent": "Mozilla/5.0 (compatible; ffmpeg-builder-scraper/1.0)",
  };

  let lastError: unknown;

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(30000), headers });

      if (!resp.ok) FFmpegScrapeError.fetchFailed(url, resp.status);

      return await resp.text();
    } catch (err) {
      lastError = err;

      if (attempt === 3) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  throw lastError instanceof Error ? lastError : FFmpegScrapeError.createFetchError(url);
}

function collectTextWithSeparator($: CheerioAPI, node: TagNode): string {
  const parts: string[] = [];

  for (const child of $(node).contents().toArray()) {
    if (child.type === "text") {
      const text = child.data?.trim() ?? "";

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

function isTagNode(node: DomNode): node is TagNode {
  return node.type === "tag";
}

function collectDdText($: CheerioAPI, ddTag: TagNode): string {
  const texts: string[] = [];

  for (const child of $(ddTag).contents().toArray()) {
    if (child.type === "text") {
      const t = child.data?.trim() ?? "";

      if (t) texts.push(htmlDecode(t));
    } else if (isTagNode(child) && child.tagName === "p") {
      texts.push(collectTextWithSeparator($, child));
    }
  }

  return htmlDecode(texts.join("\n")).trim();
}

function parseOptionTerm($: CheerioAPI, dtTag: TagNode): OptionTerm | null {
  const samp = $(dtTag).find("samp");

  if (samp.length === 0) return null;

  let fullText = collectTextWithSeparator($, samp[0]);
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

function parsePossibleValues($: CheerioAPI, dlTag: TagNode): PossibleValue[] {
  const values: PossibleValue[] = [];

  const items = $(dlTag).children("dt, dd").toArray();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    if (!isTagNode(item) || item.tagName !== "dt") continue;

    const valueName = collectTextWithSeparator($, item);
    let valueDesc = "";

    const next = i + 1 < items.length ? items[i + 1] : undefined;

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
): ScrapedOption[] {
  const options: ScrapedOption[] = [];

  const items = $(dlTag).children("dt, dd").toArray();

  let i = 0;

  while (i < items.length) {
    const item = items[i];

    if (!isTagNode(item) || item.tagName !== "dt") {
      i++;
      continue;
    }

    const aliasesTerms: TagNode[] = [item];
    let j = i + 1;

    while (j < items.length) {
      const next = items[j];

      if (!isTagNode(next) || next.tagName !== "dt") break;
      aliasesTerms.push(next);
      j++;
    }

    let ddTag: TagNode | null = null;

    if (j < items.length) {
      const next = items[j];

      if (isTagNode(next) && next.tagName === "dd") {
        ddTag = next;
      }
    }

    let primaryInfo: OptionTerm | null = null;
    const allNames: string[] = [];

    for (const dtTerm of aliasesTerms) {
      const info = parseOptionTerm($, dtTerm);

      if (info) {
        if (primaryInfo === null) {
          primaryInfo = info;
        }

        allNames.push(info.name);
      }
    }

    if (primaryInfo === null) {
      i = j;
      continue;
    }

    let desc = "";
    let possibleValues: PossibleValue[] | null = null;

    if (ddTag) {
      desc = collectDdText($, ddTag);

      if (primaryInfo.name === "qrcode_width") {
        desc = desc.replace(/¸/g, "");
      }

      const nestedDl = $(ddTag).children("dl");

      if (nestedDl.length > 0) {
        possibleValues = parsePossibleValues($, nestedDl[0]);
      }
    }

    let default_: string | null = null;

    if (desc) {
      const m = desc.match(/Default\s+(?:value\s+)?is\s+([^.\n]+)/i);

      if (m) {
        default_ = m[1].trim();
      }
    }

    let rangeInfo: ScrapedOption["range"] = null;

    if (desc) {
      const m = desc.match(
        /(?:Range|Must be)\s+(?:is\s+)?(?:between\s+)?([\d.-]+)\s+and\s+([\d.-]+)/i,
      );

      if (m) {
        rangeInfo = { min: m[1], max: m[2] };
      }
    }

    options.push({
      name: primaryInfo.name,
      aliases: primaryInfo.aliases,
      type: primaryInfo.type,
      categories: primaryInfo.categories,
      arguments: primaryInfo.arguments,
      description: desc,
      default: default_,
      range: rangeInfo,
      possible_values: possibleValues,
      page: pageName,
      page_type: PAGE_CONTEXT.get(pageName) ?? "other",
      section,
    });

    i = j;
  }

  return options;
}

async function extractOptionsFromPage(pageName: string): Promise<ScrapedOption[]> {
  const html = await fetchHTML(`${BASE_URL}/${pageName}`);

  return extractOptionsFromHtml(pageName, html);
}

export function extractOptionsFromHtml(pageName: string, html: string): ScrapedOption[] {
  const pageId = pageName.replace(/\.html$/, "");
  const $ = cheerio.load(html);
  let contentDiv = $("div.page-content.inset");

  if (contentDiv.length === 0) {
    contentDiv = $("#page-content-wrapper");
  }

  if (contentDiv.length === 0) return [];

  contentDiv.find("script, style, nav").remove();
  contentDiv.find("div.contents").remove();
  contentDiv.find('div[align="center"]').remove();

  const allOptions: ScrapedOption[] = [];
  let currentSection = "";

  for (const child of contentDiv.contents().toArray()) {
    if (!isTagNode(child)) continue;

    if (["h2", "h3", "h4"].includes(child.tagName)) {
      const text = $(child).text().trim();

      if (!text.includes("Table of Contents")) {
        currentSection = text;
      }
    } else if (child.tagName === "dl") {
      const dt = $(child).find("dt");

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

  const allOptions: ScrapedOption[] = [];

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

if (import.meta.main) {
  await main();
}
