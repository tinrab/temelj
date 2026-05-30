// Generates TypeScript declarations based on ffmpeg-options.json.
// This is largely managed by an LLM (scrape docs -> LLM -> generation).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const GENERATED_DIR = join(import.meta.dirname, "../src/generated");
const JSON_PATH = join(GENERATED_DIR, "ffmpeg-options.json");

interface RawOption {
  name: string;
  aliases: string[];
  type: string | null;
  categories: string[];
  arguments: string;
  description: string;
  default: string | null;
  range: { min: string; max: string } | null;
  possible_values: Array<{ value: string; description: string }> | null;
  page: string;
  page_type: string;
  section: string;
}

type Cat = "input" | "output" | "global";

interface Normalized {
  prop: string;
  flag: string;
  cat: Cat;
  tsType: string;
  isFlag: boolean;
  isArray: boolean;
  description: string;
  supportsStreamSpecifier: boolean;
  supportsMetadataSpecifier: boolean;
}

// Manual flag name overrides (scraper-produced flag name → actual ffmpeg flag)
const FLAG_OVERRIDES: Record<string, string> = {
  programst: "-program",
  stream_groupst: "-stream_group",
};

// Custom type alias definitions emitted in generated output.
// Keep only types that can't be auto-generated from scraped possible_values.
const CUSTOM_TYPES: Record<string, string> = {
  Bitrate: "`${number}k` | `${number}M` | `${number}G`",
  FrameSize: "`${number}x${number}`",
  LogLevel:
    '"quiet" | "panic" | "fatal" | "error" | "warning" | "info" | "verbose" | "debug" | "trace"',
  Vsync: '"passthrough" | "cfr" | "vfr" | "drop" | "auto" | number',
  Target:
    '"vcd" | "svcd" | "dvd" | "dv" | "dv50" | "pal-vcd" | "pal-svcd" | "pal-dvd" | "ntsc-vcd" | "ntsc-svcd" | "ntsc-dvd"',
  AspectRatio: "`${number}:${number}` | `${number}/${number}` | number",
  /** Encoder preset (not from scraped JSON — -preset is an encoder AVOption, not a CLI option with documented possible_values) */
  Preset:
    '"ultrafast" | "superfast" | "veryfast" | "faster" | "fast" | "medium" | "slow" | "slower" | "veryslow" | "placebo"',
};

// Maps property names to custom type aliases above
const TYPE_ALIASES: Record<string, string> = {
  videoBitrate: "Bitrate",
  audioBitrate: "Bitrate",
  subtitleBitrate: "Bitrate",
  minrate: "Bitrate",
  maxrate: "Bitrate",
  bufsize: "Bitrate",
  s: "FrameSize",
  canvasSize: "FrameSize",
  loglevel: "LogLevel",
  vsync: "Vsync",
  target: "Target",
  aspect: "AspectRatio",
  preset: "Preset",
  movflags: "MovFlag",
  strict: "Strict",
  avoidNegativeTs: "AvoidNegativeTs",
  errDetect: "ErrDetect",
  fflags: "FFlags",
  defaultMode: "DefaultMode",
};

// Flag names from non-ffmpeg pages whose possible_values should auto-generate named types.
// These are looked up in the full scraped JSON at generation time.
// The generated type is widened with a string fallback to allow values like "+faststart".
const EXTRA_ENUM_TYPES: Record<string, string> = {
  movflags: "MovFlag",
  strict: "Strict",
  avoid_negative_ts: "AvoidNegativeTs",
  err_detect: "ErrDetect",
  fflags: "FFlags",
  default_mode: "DefaultMode",
};

// Flag names whose possible_values from the scraped JSON can generate union types.
// These must have clean, finite enum values documented in ffmpeg's option table.
// Excluded on purpose:
//   loglevel — scraper captures flag prefixes (repeat,level,time,datetime), not the actual loglevel values
//   vsync    — needs | number fallback and includes "drop" not in scraped values
//   report   — scraper values (file,level) are misleading, not real enum options for -report
const ENUM_FLAGS = new Set(["hwaccel", "discard", "copytb", "apply_cropping", "abort_on"]);

function cleanEnumValue(raw: string): string {
  let v = raw.trim();
  v = v.replace(/^['\u2018\u2019]\s*/, "").replace(/\s*['\u2018\u2019]$/, "");
  v = v.replace(/\s*\(.*?\)\s*$/, "").trim();
  return v;
}

function generateEnumType(
  flagName: string,
  possibleValues: Array<{ value: string; description: string }> | null,
): string | null {
  if (!possibleValues || possibleValues.length === 0) return null;
  if (!ENUM_FLAGS.has(flagName) && !(flagName in EXTRA_ENUM_TYPES)) return null;

  const literals: string[] = [];
  for (const pv of possibleValues) {
    const cleaned = cleanEnumValue(pv.value);
    if (!cleaned) return null;
    if (/^-?\d+(\.\d+)?$/.test(cleaned)) {
      literals.push(cleaned);
    } else if (/^[a-zA-Z_]\w*$/.test(cleaned)) {
      literals.push(`"${cleaned}"`);
    } else {
      return null;
    }
  }
  return literals.join(" | ");
}

// Maps snake_case or raw ffmpeg flag names to camelCase property names
const PROP_OVERRIDES: Record<string, string> = {
  accurate_seek: "accurateSeek",
  seek_timestamp: "seekTimestamp",
  stream_loop: "streamLoop",
  readrate_catchup: "readrateCatchup",
  guess_layout_max: "guessLayoutMax",
  hwaccel_device: "hwaccelDevice",
  init_hw_device: "initHwDevice",
  filter_hw_device: "filterHwDevice",
  fix_sub_duration_heartbeat: "fixSubDurationHeartbeat",
  readrate_initial_burst: "readrateInitialBurst",
  dts_delta_threshold: "dtsDeltaThreshold",
  dts_error_threshold: "dtsErrorThreshold",
  thread_queue_size: "threadQueueSize",
  display_rotation: "displayRotation",
  display_hflip: "displayHflip",
  display_vflip: "displayVflip",
  mastering_display: "masteringDisplay",
  content_light: "contentLight",
  apply_cropping: "applyCropping",
  dump_attachment: "dumpAttachment",
  reinit_filter: "reinitFilter",
  drop_changed: "dropChanged",
  force_key_frames: "forceKeyFrames",
  pix_fmt: "pixFmt",
  sample_fmt: "sampleFmt",
  channel_layout: "channelLayout",
  ch_layout: "chLayout",
  sws_flags: "swsFlags",
  rc_override: "rcOverride",
  passlogfile: "passLogfile",
  vstats_file: "vstatsFile",
  vstats_version: "vstatsVersion",
  enc_time_base: "encTimeBase",
  bits_per_raw_sample: "bitsPerRawSample",
  stats_enc_pre: "statsEncPre",
  stats_enc_pre_fmt: "statsEncPreFmt",
  stats_enc_post: "statsEncPost",
  stats_enc_post_fmt: "statsEncPostFmt",
  max_muxing_queue_size: "maxMuxingQueueSize",
  muxing_queue_data_threshold: "muxingQueueDataThreshold",
  shortest_buf_duration: "shortestBufDuration",
  auto_conversion_filters: "autoConversionFilters",
  fix_sub_duration: "fixSubDuration",
  max_error_rate: "maxErrorRate",
  filter_complex: "filterComplex",
  filter_complex_threads: "filterComplexThreads",
  filter_threads: "filterThreads",
  filter_buffered_frames: "filterBufferedFrames",
  print_graphs: "printGraphs",
  print_graphs_file: "printGraphsFile",
  print_graphs_format: "printGraphsFormat",
  stats_period: "statsPeriod",
  benchmark_all: "benchmarkAll",
  debug_ts: "debugTs",
  no_stdin: "noStdin",
  no_stats: "noStats",
  sdp_file: "sdpFile",
  frame_drop_threshold: "frameDropThreshold",
  recast_media: "recastMedia",
  hide_banner: "hideBanner",
  map_chapters: "mapChapters",
  map_metadata: "mapMetadata",
  stream_groupst: "streamGroup",
  programst: "program",
  copyts: "copyTs",
  start_at_zero: "startAtZero",
  copytb: "copyTb",
  bitexact: "bitExact",
};

// Manual category overrides
const OPT_CAT: Record<string, Cat[]> = {
  i: ["input"],
  stream_loop: ["input"],
  re: ["input"],
  isync: ["input"],
  sseof: ["input"],
  itsoffset: ["input"],
  itsscale: ["input"],
  hwaccel: ["input"],
  hwaccel_device: ["input"],
  init_hw_device: ["input"],
  filter_hw_device: ["input"],
  readrate: ["input"],
  readrate_catchup: ["input"],
  readrate_initial_burst: ["input"],
  discard: ["input"],
  guess_layout_max: ["input"],
  thread_queue_size: ["input", "output"],
  display_rotation: ["input"],
  display_hflip: ["input"],
  display_vflip: ["input"],
  mastering_display: ["input"],
  content_light: ["input"],
  apply_cropping: ["input"],
  dump_attachment: ["input"],
  reinit_filter: ["input"],
  drop_changed: ["input"],
  fix_sub_duration_heartbeat: ["input"],
  accurate_seek: ["input"],
  seek_timestamp: ["input"],
  copyts: ["input"],
  start_at_zero: ["input"],
  copytb: ["input"],
  dts_delta_threshold: ["input"],
  dts_error_threshold: ["input"],
  timecode: ["input"],
  bitexact: ["input"],
  ignore_unknown: ["input"],
  copy_unknown: ["input"],
  vn: ["input", "output"],
  an: ["input", "output"],
  sn: ["input", "output"],
  dn: ["input", "output"],
  r: ["input", "output"],

  // Output
  map: ["output"],
  map_metadata: ["output"],
  map_chapters: ["output"],
  metadata: ["output"],
  disposition: ["output"],
  target: ["output"],
  programst: ["output"],
  stream_groupst: ["output"],
  attach: ["output"],
  apad: ["output"],
  streamid: ["output"],
  vstats: ["output"],
  vstats_file: ["output"],
  vstats_version: ["output"],
  fs: ["output"],
  timestamp: ["output"],
  bsf: ["input", "output"],
  copyinkf: ["output"],
  pre: ["output"],
  force_key_frames: ["output"],
  enc_time_base: ["output"],
  bits_per_raw_sample: ["output"],
  stats_enc_pre: ["output"],
  stats_enc_pre_fmt: ["output"],
  ch_layout: ["output"],
  channel_layout: ["output"],
  sample_fmt: ["output"],
  pix_fmt: ["input", "output"],
  sws_flags: ["input", "output"],
  canvas_size: ["output"],
  shortest_buf_duration: ["output"],
  rc_override: ["output"],
  passlogfile: ["output"],
  vtag: ["output"],
  atag: ["output"],
  scodec: ["output"],
  muxing_queue_data_threshold: ["output"],

  // Global
  y: ["global"],
  n: ["global"],
  loglevel: ["global"],
  stats: ["global"],
  stats_period: ["global"],
  progress: ["global"],
  benchmark: ["global"],
  benchmark_all: ["global"],
  timelimit: ["global"],
  vsync: ["global"],
  filter_complex: ["global"],
  filter_complex_threads: ["global"],
  lavfi: ["global"],
  report: ["global"],
  xerror: ["global"],
  stdin: ["global"],
  cpuflags: ["global"],
  cpucount: ["global"],
  debug_ts: ["global"],
  dump: ["global"],
  hex: ["global"],
  auto_conversion_filters: ["global"],
  fix_sub_duration: ["global"],
  abort_on: ["global"],
  max_error_rate: ["global"],
  recast_media: ["global"],
  sdp_file: ["global"],
  print_graphs: ["global"],
  print_graphs_file: ["global"],
  print_graphs_format: ["global"],
  frame_drop_threshold: ["global"],
  autorotate: ["global"],
  autoscale: ["global"],
  hide_banner: ["global"],
  filter_threads: ["global"],
  filter_buffered_frames: ["global"],

  // Input/output (both)
  ss: ["input", "output"],
  t: ["input", "output"],
  to: ["input", "output"],
  f: ["input", "output"],
};

const KNOWN_ARG_WORDS = new Set([
  "number",
  "count",
  "duration",
  "position",
  "offset",
  "url",
  "codec",
  "filename",
  "file",
  "name",
  "format",
  "freq",
  "size",
  "limit_size",
  "parameter",
  "parameters",
  "speed",
  "fps",
  "framecount",
  "filtergraph",
  "prefix",
  "tag",
  "fourcc/tag",
  "time",
  "flags",
  "value",
  "key",
  "date",
  "channels",
  "layout",
  "channel_layout",
  "type",
  "infile",
  "input_file_id",
  "input_file_index",
  "input_index",
  "index",
  "output-stream-index",
  "new-value",
  "packets",
  "bytes",
  "seconds",
  "timebase",
  "metadata_specifier",
  "stream_specifier",
  "nb_threads",
  "nb_frames",
  "preset_name",
  "bitstream_filters",
  "mode",
  "scale",
  "rotation",
  "source",
  "hwaccel",
  "hwaccel_device",
  "device",
  "threads",
  "config",
  "path",
  "format_spec",
  "threshold",
  "timecode",
  "hh",
  "mm",
  "ss",
  "SEP",
  "ff",
  "display",
  "display_rotation",
  "display_hflip",
  "display_vflip",
  "stream",
  "title",
  "map",
  "group",
  "program",
  "type]",
  "type@",
  "list",
  "opt1",
  "val1",
  "opt2",
  "val2",
  "opt",
  "input_file_id",
  "stream_group",
  "additional_stream_specifier",
  "stream_type",
  "group_specifier",
  "program_id",
  "stream_id",
  "group_index",
  "group_id",
  "dispositions",
  "arg",
  "sample_fmt",
  "rate",
  "bitrate",
  ":",
  "|",
]);

function cleanFlagName(rawName: string): string {
  let f = rawName.trim();
  if (!f.startsWith("-")) return f;
  const spaceIdx = f.indexOf(" ");
  if (spaceIdx > 0) {
    const before = f.slice(0, spaceIdx).replace(/=$/, "");
    const after = f.slice(spaceIdx + 1).trim();
    const words = after.split(/[\s,|/]+/).filter(Boolean);
    const allKnown = words.length > 0 && words.every((w) => KNOWN_ARG_WORDS.has(w));
    if (allKnown || words.length <= 3) {
      return before;
    }
  }
  return f;
}

function toCamel(s: string): string {
  if (PROP_OVERRIDES[s]) return PROP_OVERRIDES[s];
  return s.replace(/[-_][a-z]/g, (m) => m[1].toUpperCase());
}

function toPropName(flag: string): string {
  let p = flag.replace(/^-/, "");
  p = p.replace(/[:-]/g, "_");
  p = p.replace(/[^a-zA-Z0-9_]/g, "");
  return toCamel(p);
}

function inferType(
  flag: string,
  rawName: string,
  rawType: string | null,
  possibleValues: Array<{ value: string; description: string }> | null,
  description: string,
): { tsType: string; isFlag: boolean; isArray: boolean } {
  const flagName = flag.replace(/^-/, "");
  const descLower = description.toLowerCase();
  const rawNameLower = rawName.toLowerCase();

  const boolFlags = new Set([
    "y",
    "n",
    "vn",
    "an",
    "sn",
    "dn",
    "re",
    "stats",
    "stdin",
    "dump",
    "hex",
    "report",
    "xerror",
    "benchmark",
    "benchmark_all",
    "debug_ts",
    "shortest",
    "copyinkf",
    "accurate_seek",
    "seek_timestamp",
    "copyts",
    "start_at_zero",
    "ignore_unknown",
    "copy_unknown",
    "fix_sub_duration",
    "auto_conversion_filters",
    "recast_media",
    "nostdin",
    "nostats",
    "hide_banner",
    "autorotate",
    "autoscale",
    "noautorotate",
    "bitexact",
    "print_graphs",
    "reinit_filter",
    "drop_changed",
    "display_hflip",
    "display_vflip",
  ]);
  if (boolFlags.has(flagName)) {
    return { tsType: "boolean", isFlag: true, isArray: false };
  }

  const numFlags = new Set([
    "vframes",
    "aframes",
    "dframes",
    "fpsmax",
    "loop",
    "stream_loop",
    "cpucount",
    "filter_threads",
    "filter_buffered_frames",
    "max_muxing_queue_size",
    "muxing_queue_data_threshold",
    "bits_per_raw_sample",
    "pass",
    "ac",
    "guess_layout_max",
    "frame_drop_threshold",
    "vstats_version",
    "dts_delta_threshold",
    "dts_error_threshold",
    "aq",
    "isync",
    "q",
    "itsscale",
  ]);
  if (numFlags.has(flagName)) {
    return { tsType: "number", isFlag: false, isArray: false };
  }

  const durFlags = new Set([
    "ss",
    "t",
    "to",
    "itsoffset",
    "timelimit",
    "muxdelay",
    "muxpreload",
    "readrate",
    "readrate_catchup",
    "stats_period",
    "sseof",
    "shortest_buf_duration",
    "readrate_initial_burst",
    "r",
  ]);
  if (durFlags.has(flagName)) {
    return { tsType: "Duration", isFlag: false, isArray: false };
  }

  const arrFlags = new Set([
    "map",
    "map_metadata",
    "map_chapters",
    "metadata",
    "disposition",
    "streamid",
    "programst",
    "stream_groupst",
  ]);
  if (arrFlags.has(flagName)) {
    return { tsType: "string", isFlag: false, isArray: true };
  }

  const stringFlags = new Set(["fix_sub_duration_heartbeat"]);
  if (stringFlags.has(flagName)) {
    return { tsType: "string", isFlag: false, isArray: false };
  }

  if (rawType === "integer" || rawType === "int64") {
    return { tsType: "number", isFlag: false, isArray: false };
  }
  if (rawType === "boolean") {
    return { tsType: "boolean", isFlag: false, isArray: false };
  }
  if (rawType === "duration") {
    return { tsType: "Duration", isFlag: false, isArray: false };
  }
  if (rawType === "float" || rawType === "double" || rawType === "rational") {
    return { tsType: "number", isFlag: false, isArray: false };
  }

  if (
    rawNameLower.includes("number") ||
    rawNameLower.includes("count") ||
    rawNameLower.includes("nb_") ||
    rawNameLower.includes("packets") ||
    rawNameLower.includes("bytes") ||
    rawNameLower.includes("channels") ||
    rawNameLower.includes("freq")
  ) {
    return { tsType: "number", isFlag: false, isArray: false };
  }
  if (
    rawNameLower.includes("duration") ||
    rawNameLower.includes("position") ||
    rawNameLower.includes("offset") ||
    rawNameLower.includes("seconds") ||
    rawNameLower.includes("timebase") ||
    rawNameLower.includes("timecode")
  ) {
    return { tsType: "Duration", isFlag: false, isArray: false };
  }

  if (
    /\b(integer|count|threshold|packets|bytes)\b/.test(descLower) &&
    !descLower.includes("string")
  ) {
    return { tsType: "number", isFlag: false, isArray: false };
  }

  return { tsType: "string", isFlag: false, isArray: false };
}

function classify(flagName: string, raw: RawOption): Cat[] {
  // Check manual overrides FIRST
  const catFromOpt = OPT_CAT[flagName] ?? null;
  if (catFromOpt) {
    return [...catFromOpt];
  }

  // Fall back to raw categories from JSON
  const cats = raw.categories.map((c: string) => c.toLowerCase().trim());

  const result: Cat[] = [];
  if (cats.includes("input") || cats.includes("input/output")) result.push("input");
  if (cats.includes("output") || cats.includes("input/output")) result.push("output");
  if (cats.includes("global")) result.push("global");

  return result;
}

function shouldExclude(raw: RawOption): boolean {
  const name = raw.name.trim();
  if (/^(stream_index|stream_type|g:|p:|m:|disp:|# )/.test(name)) return true;
  if (name === "u") return true;
  if (/^(avg_br|br|frame|out|PSNR|q|f_size|s_size|st|time|type)$/.test(name)) return true;
  if (["generic", "private"].includes(name)) return true;

  const infoFlags = new Set([
    "L",
    "h",
    "version",
    "buildconf",
    "formats",
    "demuxers",
    "muxers",
    "devices",
    "codecs",
    "decoders",
    "encoders",
    "bsfs",
    "protocols",
    "filters",
    "pix_fmts",
    "sample_fmts",
    "layouts",
    "dispositions",
    "colors",
    "sources",
    "sinks",
    "hwaccels",
    "max_alloc",
    "init_hw_device",
  ]);
  const firstWord = name.startsWith("-") ? name.slice(1).split(/\s/)[0] : "";
  if (infoFlags.has(firstWord)) return true;
  if (name.startsWith("-sources") || name.startsWith("-sinks")) return true;
  return false;
}

async function loadJSON(): Promise<RawOption[]> {
  const data = JSON.parse(await readFile(JSON_PATH, "utf-8"));
  return data.options;
}

function normalize(raw: RawOption[]): Normalized[] {
  const entries = new Map<string, Normalized>();

  for (const opt of raw) {
    if (opt.page !== "ffmpeg") continue;
    if (shouldExclude(opt)) continue;

    const cleanName = cleanFlagName(opt.name);
    const flagName = cleanName.replace(/^-/, "");
    const flag = FLAG_OVERRIDES[flagName] ?? cleanName;

    const categories = classify(flagName, opt);

    if (categories.length === 0) continue;

    const prop = toPropName(cleanName);

    let { tsType, isFlag, isArray } = inferType(
      cleanName,
      opt.name,
      opt.type,
      opt.possible_values,
      opt.description,
    );

    const enumType = generateEnumType(flagName, opt.possible_values);
    if (enumType) {
      tsType = enumType;
    }

    const desc = opt.description.split("\n")[0].replace(/`/g, "'").trim().slice(0, 120);
    const supportsStreamSpecifier = opt.categories.includes("per-stream");
    const supportsMetadataSpecifier = opt.categories.includes("per-metadata");

    // Create an entry for EACH category this option belongs to
    for (const cat of categories) {
      const dedupKey = `${prop}:${cat}`;
      const existing = entries.get(dedupKey);
      if (existing) {
        existing.supportsStreamSpecifier ||= supportsStreamSpecifier;
        existing.supportsMetadataSpecifier ||= supportsMetadataSpecifier;
        continue;
      }

      entries.set(dedupKey, {
        prop,
        flag,
        cat,
        tsType,
        isFlag,
        isArray,
        description: desc,
        supportsStreamSpecifier,
        supportsMetadataSpecifier,
      });
    }
  }

  // Add stream-specifier aliases that are commonly used but may not be in JSON
  const extras: Normalized[] = [
    {
      prop: "videoCodec",
      flag: "-c:v",
      cat: "output",
      tsType: "string",
      isFlag: false,
      isArray: false,
      description: "Video codec (-c:v)",
      supportsStreamSpecifier: true,
      supportsMetadataSpecifier: false,
    },
    {
      prop: "audioCodec",
      flag: "-c:a",
      cat: "output",
      tsType: "string",
      isFlag: false,
      isArray: false,
      description: "Audio codec (-c:a)",
      supportsStreamSpecifier: true,
      supportsMetadataSpecifier: false,
    },
    {
      prop: "subtitleCodec",
      flag: "-c:s",
      cat: "output",
      tsType: "string",
      isFlag: false,
      isArray: false,
      description: "Subtitle codec (-c:s)",
      supportsStreamSpecifier: true,
      supportsMetadataSpecifier: false,
    },
    {
      prop: "dataCodec",
      flag: "-c:d",
      cat: "output",
      tsType: "string",
      isFlag: false,
      isArray: false,
      description: "Data codec (-c:d)",
      supportsStreamSpecifier: true,
      supportsMetadataSpecifier: false,
    },
    {
      prop: "videoBitrate",
      flag: "-b:v",
      cat: "output",
      tsType: "string",
      isFlag: false,
      isArray: false,
      description: "Video bitrate (-b:v)",
      supportsStreamSpecifier: true,
      supportsMetadataSpecifier: false,
    },
    {
      prop: "audioBitrate",
      flag: "-b:a",
      cat: "output",
      tsType: "string",
      isFlag: false,
      isArray: false,
      description: "Audio bitrate (-b:a)",
      supportsStreamSpecifier: true,
      supportsMetadataSpecifier: false,
    },
    {
      prop: "subtitleBitrate",
      flag: "-b:s",
      cat: "output",
      tsType: "string",
      isFlag: false,
      isArray: false,
      description: "Subtitle bitrate (-b:s)",
      supportsStreamSpecifier: true,
      supportsMetadataSpecifier: false,
    },
    {
      prop: "vq",
      flag: "-q:v",
      cat: "output",
      tsType: "number",
      isFlag: false,
      isArray: false,
      description: "Video quality (-q:v)",
      supportsStreamSpecifier: true,
      supportsMetadataSpecifier: false,
    },
    {
      prop: "aq",
      flag: "-q:a",
      cat: "output",
      tsType: "number",
      isFlag: false,
      isArray: false,
      description: "Audio quality (-q:a)",
      supportsStreamSpecifier: true,
      supportsMetadataSpecifier: false,
    },
    {
      prop: "overwrite",
      flag: "-y",
      cat: "global",
      tsType: "boolean",
      isFlag: true,
      isArray: false,
      description: "Overwrite output files",
      supportsStreamSpecifier: false,
      supportsMetadataSpecifier: false,
    },
    {
      prop: "noOverwrite",
      flag: "-n",
      cat: "global",
      tsType: "boolean",
      isFlag: true,
      isArray: false,
      description: "Do not overwrite output files",
      supportsStreamSpecifier: false,
      supportsMetadataSpecifier: false,
    },
    {
      prop: "accurateSeek",
      flag: "-accurate_seek",
      cat: "input",
      tsType: "boolean",
      isFlag: true,
      isArray: false,
      description: "Enable accurate seeking",
      supportsStreamSpecifier: false,
      supportsMetadataSpecifier: false,
    },
    {
      prop: "seekTimestamp",
      flag: "-seek_timestamp",
      cat: "input",
      tsType: "boolean",
      isFlag: true,
      isArray: false,
      description: "Enable seeking by timestamp",
      supportsStreamSpecifier: false,
      supportsMetadataSpecifier: false,
    },
    {
      prop: "qscale",
      flag: "-qscale",
      cat: "output",
      tsType: "number",
      isFlag: false,
      isArray: false,
      description: "Use fixed quality scale (VBR)",
      supportsStreamSpecifier: true,
      supportsMetadataSpecifier: false,
    },
    {
      prop: "level",
      flag: "-level",
      cat: "output",
      tsType: "string",
      isFlag: false,
      isArray: false,
      description: "Set codec level",
      supportsStreamSpecifier: true,
      supportsMetadataSpecifier: false,
    },
    {
      prop: "profile",
      flag: "-profile",
      cat: "output",
      tsType: "string",
      isFlag: false,
      isArray: false,
      description: "Set codec profile",
      supportsStreamSpecifier: true,
      supportsMetadataSpecifier: false,
    },
    {
      prop: "preset",
      flag: "-preset",
      cat: "output",
      tsType: "string",
      isFlag: false,
      isArray: false,
      description: "Set codec preset",
      supportsStreamSpecifier: true,
      supportsMetadataSpecifier: false,
    },
    {
      prop: "tune",
      flag: "-tune",
      cat: "output",
      tsType: "string",
      isFlag: false,
      isArray: false,
      description: "Set codec tuning",
      supportsStreamSpecifier: true,
      supportsMetadataSpecifier: false,
    },
    {
      prop: "crf",
      flag: "-crf",
      cat: "output",
      tsType: "number",
      isFlag: false,
      isArray: false,
      description: "Set CRF value (codec-specific)",
      supportsStreamSpecifier: true,
      supportsMetadataSpecifier: false,
    },
    {
      prop: "movflags",
      flag: "-movflags",
      cat: "output",
      tsType: "string",
      isFlag: false,
      isArray: false,
      description: "Set mov/mp4 writing flags",
      supportsStreamSpecifier: false,
      supportsMetadataSpecifier: false,
    },
    {
      prop: "minrate",
      flag: "-minrate",
      cat: "output",
      tsType: "string",
      isFlag: false,
      isArray: false,
      description: "Set min bitrate tolerance",
      supportsStreamSpecifier: true,
      supportsMetadataSpecifier: false,
    },
    {
      prop: "maxrate",
      flag: "-maxrate",
      cat: "output",
      tsType: "string",
      isFlag: false,
      isArray: false,
      description: "Set max bitrate tolerance",
      supportsStreamSpecifier: true,
      supportsMetadataSpecifier: false,
    },
    {
      prop: "bufsize",
      flag: "-bufsize",
      cat: "output",
      tsType: "string",
      isFlag: false,
      isArray: false,
      description: "Set rate control buffer size",
      supportsStreamSpecifier: true,
      supportsMetadataSpecifier: false,
    },
    {
      prop: "codec",
      flag: "-codec",
      cat: "output",
      tsType: "string",
      isFlag: false,
      isArray: false,
      description: "Select codec for stream",
      supportsStreamSpecifier: true,
      supportsMetadataSpecifier: false,
    },
    {
      prop: "loop",
      flag: "-loop",
      cat: "input",
      tsType: "number",
      isFlag: false,
      isArray: false,
      description: "Loop input (0=infinite)",
      supportsStreamSpecifier: false,
      supportsMetadataSpecifier: false,
    },
    {
      prop: "initHwDevice",
      flag: "-init_hw_device",
      cat: "input",
      tsType: "string",
      isFlag: false,
      isArray: false,
      description: "Initialize hardware device",
      supportsStreamSpecifier: false,
      supportsMetadataSpecifier: false,
    },
    {
      prop: "passLogfile",
      flag: "-passlogfile",
      cat: "output",
      tsType: "string",
      isFlag: false,
      isArray: false,
      description: "Set two-pass log file name prefix",
      supportsStreamSpecifier: true,
      supportsMetadataSpecifier: false,
    },
    {
      prop: "statsEncPost",
      flag: "-stats_enc_post",
      cat: "output",
      tsType: "number",
      isFlag: false,
      isArray: false,
      description: "Write per-frame encoding info post-encode",
      supportsStreamSpecifier: true,
      supportsMetadataSpecifier: false,
    },
    {
      prop: "statsEncPostFmt",
      flag: "-stats_enc_post_fmt",
      cat: "output",
      tsType: "string",
      isFlag: false,
      isArray: false,
      description: "Format for stats_enc_post",
      supportsStreamSpecifier: true,
      supportsMetadataSpecifier: false,
    },
    {
      prop: "noStdin",
      flag: "-nostdin",
      cat: "global",
      tsType: "boolean",
      isFlag: true,
      isArray: false,
      description: "Disable interaction on standard input",
      supportsStreamSpecifier: false,
      supportsMetadataSpecifier: false,
    },
    {
      prop: "noStats",
      flag: "-nostats",
      cat: "global",
      tsType: "boolean",
      isFlag: true,
      isArray: false,
      description: "Disable encoding progress/statistics",
      supportsStreamSpecifier: false,
      supportsMetadataSpecifier: false,
    },
    {
      prop: "strict",
      flag: "-strict",
      cat: "output",
      tsType: "string",
      isFlag: false,
      isArray: false,
      description: "Strict standard compliance",
      supportsStreamSpecifier: false,
      supportsMetadataSpecifier: false,
    },
    {
      prop: "avoidNegativeTs",
      flag: "-avoid_negative_ts",
      cat: "output",
      tsType: "string",
      isFlag: false,
      isArray: false,
      description: "Avoid negative timestamps",
      supportsStreamSpecifier: false,
      supportsMetadataSpecifier: false,
    },
    {
      prop: "errDetect",
      flag: "-err_detect",
      cat: "input",
      tsType: "string",
      isFlag: false,
      isArray: false,
      description: "Error detection level",
      supportsStreamSpecifier: false,
      supportsMetadataSpecifier: false,
    },
    {
      prop: "fflags",
      flag: "-fflags",
      cat: "input",
      tsType: "string",
      isFlag: false,
      isArray: false,
      description: "Format flags",
      supportsStreamSpecifier: false,
      supportsMetadataSpecifier: false,
    },
    {
      prop: "defaultMode",
      flag: "-default_mode",
      cat: "output",
      tsType: "string",
      isFlag: false,
      isArray: false,
      description: "Default stream selection mode",
      supportsStreamSpecifier: false,
      supportsMetadataSpecifier: false,
    },
  ];

  for (const extra of extras) {
    const dedupKey = `${extra.prop}:${extra.cat}`;
    const existing = entries.get(dedupKey);
    if (existing) {
      existing.supportsStreamSpecifier ||= extra.supportsStreamSpecifier;
      existing.supportsMetadataSpecifier ||= extra.supportsMetadataSpecifier;
      continue;
    }

    entries.set(dedupKey, extra);
  }

  return [...entries.values()];
}

function generateInterfaces(normals: Normalized[], meta: any): string {
  const byCat: Record<Cat, Normalized[]> = { input: [], output: [], global: [] };
  for (const n of normals) {
    if (n.cat === "input") byCat.input.push(n);
    else if (n.cat === "output") byCat.output.push(n);
    else if (n.cat === "global") byCat.global.push(n);
  }

  let out = `
    // auto-generated from ffmpeg-options.json — do not edit
    // scraper run: ${meta.generated}

    export type Duration = string | number
    export type SerializedOptionScalar = string | number | boolean
    export type SerializedOptionValue = SerializedOptionScalar | readonly SerializedOptionScalar[]
    export type RawOptionBag = Partial<Record<\`-\${string}\`, SerializedOptionValue>>
    export type StreamType = "v" | "V" | "a" | "s" | "d" | "t"
    export type StreamSpecifier =
      | StreamType
      | \`\${number}\`
      | \`\${StreamType}:\${number}\`
      | \`p:\${number}\`
      | \`g:\${number}\`
      | \`#\${number}\`
      | \`i:\${number}\`
      | \`m:\${string}:\${string}\`
      | \`disp:\${string}\`
      | "u"
    export type StreamOptionBag<T> = Partial<Record<StreamSpecifier, T>>
    export type MetadataSpecifier =
      | "g"
      | \`s:\${StreamSpecifier}\`
      | \`c:\${number}\`
      | \`p:\${number}\`
    export type MetadataOptionBag<T> = Partial<Record<MetadataSpecifier, T>>

    ${Object.entries(CUSTOM_TYPES)
      .map(([name, def]) => `export type ${name} = ${def}`)
      .join("\n")}

  `;

  for (const [cat, items] of Object.entries(byCat)) {
    if (items.length === 0) continue;
    const name = cat.charAt(0).toUpperCase() + cat.slice(1) + "Options";
    out += `export interface ${name} {\n`;
    items.sort((a, b) => {
      if (a.description && !b.description) return -1;
      if (!a.description && b.description) return 1;
      return a.prop.localeCompare(b.prop);
    });
    for (const item of items) {
      if (item.description) {
        out += `  /** ${item.description} */\n`;
      }
      const alias = TYPE_ALIASES[item.prop];
      const optType = alias ?? (item.isArray ? "string | string[]" : item.tsType);
      out += `  ${item.prop}?: ${optType}\n`;
    }
    if (cat === "input") {
      out += `  /** Stream-specifier scoped input options, serialized as flags like -r:v:0 or -hwaccel:a. */\n`;
      out += `  streams?: StreamOptionBag<InputStreamOptions>\n`;
    }
    if (cat === "output") {
      out += `  /** Stream-specifier scoped output options, serialized as flags like -c:v:0 or -b:a. */\n`;
      out += `  streams?: StreamOptionBag<OutputStreamOptions>\n`;
      out += `  /** Metadata-specifier scoped output options, serialized as flags like -metadata:s:v:0. */\n`;
      out += `  metadataScopes?: MetadataOptionBag<OutputMetadataOptions>\n`;
    }
    out += `  /** Escape hatch for raw ffmpeg flags not modeled by this interface yet. Keys must be full CLI flags, e.g. "-metadata:s:v". */\n`;
    out += `  raw?: RawOptionBag\n`;
    out += `}\n\n`;
  }

  const inputStreamItems = byCat.input.filter((item) => item.supportsStreamSpecifier);
  const outputStreamItems = byCat.output.filter((item) => item.supportsStreamSpecifier);
  const outputMetadataItems = byCat.output.filter((item) => item.supportsMetadataSpecifier);

  const emitScopedInterface = (name: string, items: Normalized[]) => {
    out += `export interface ${name} {\n`;
    for (const item of items.sort((a, b) => a.prop.localeCompare(b.prop))) {
      const alias = TYPE_ALIASES[item.prop];
      const optType = alias ?? (item.isArray ? "string | string[]" : item.tsType);
      out += `  ${item.prop}?: ${optType}\n`;
    }
    out += `}\n\n`;
  };

  emitScopedInterface("InputStreamOptions", inputStreamItems);
  emitScopedInterface("OutputStreamOptions", outputStreamItems);
  emitScopedInterface("OutputMetadataOptions", outputMetadataItems);

  return out;
}

function generateSerialize(normals: Normalized[], meta: any): string {
  const byCat: Record<Cat, Normalized[]> = { input: [], output: [], global: [] };
  for (const n of normals) {
    if (n.cat === "input") {
      byCat.input.push(n);
    } else if (n.cat === "output") {
      byCat.output.push(n);
    } else if (n.cat === "global") {
      byCat.global.push(n);
    }
  }

  let out = `// auto-generated from ffmpeg-options.json — do not edit
// scraper run: ${meta.generated}
// source: ${meta.source}

const makeFlag = (flag: string) => ({ flag, isFlag: true as const, isArray: false as const })
const makeValue = (flag: string) => ({ flag, isFlag: false as const, isArray: false as const })
const makeArray = (flag: string) => ({ flag, isFlag: false as const, isArray: true as const })

`;

  for (const [cat, items] of Object.entries(byCat)) {
    if (items.length === 0) continue;
    const name = `generated${cat.charAt(0).toUpperCase() + cat.slice(1)}Defs`;
    out += `export const ${name}: Record<string, { flag: string; isFlag: boolean; isArray: boolean }> = {\n`;
    for (const item of items) {
      const maker = item.isArray ? "makeArray" : item.isFlag ? "makeFlag" : "makeValue";
      out += `  ${item.prop}: ${maker}("${item.flag}"),\n`;
    }
    out += `}\n\n`;
  }

  const scopedDefs = [
    ["generatedInputStreamDefs", byCat.input.filter((item) => item.supportsStreamSpecifier)],
    ["generatedOutputStreamDefs", byCat.output.filter((item) => item.supportsStreamSpecifier)],
    ["generatedOutputMetadataDefs", byCat.output.filter((item) => item.supportsMetadataSpecifier)],
  ] as const;

  for (const [name, items] of scopedDefs) {
    out += `export const ${name}: Record<string, { flag: string; isFlag: boolean; isArray: boolean }> = {\n`;
    for (const item of items) {
      const maker = item.isArray ? "makeArray" : item.isFlag ? "makeFlag" : "makeValue";
      out += `  ${item.prop}: ${maker}("${item.flag}"),\n`;
    }
    out += `}\n\n`;
  }

  return out;
}

async function main() {
  const raw = await loadJSON();
  console.log(`Loaded ${raw.length} options`);

  // Auto-generate types from scraped possible_values for explicitly listed flags.
  for (const [flagName, typeName] of Object.entries(EXTRA_ENUM_TYPES)) {
    const rawOpt = raw.find(
      (o) =>
        o.possible_values &&
        o.possible_values.length > 0 &&
        o.name.replace(/^-/, "").startsWith(flagName),
    );
    if (!rawOpt?.possible_values) {
      console.warn(
        `  WARN: No possible_values found for "${flagName}" — skipping type "${typeName}"`,
      );
      continue;
    }
    const enumType = generateEnumType(flagName, rawOpt.possible_values);
    if (enumType) {
      CUSTOM_TYPES[typeName] = `${enumType} | (string & Record<never, never>)`;
      console.log(
        `  Auto-generated type "${typeName}" = ${enumType} (widened with string fallback)`,
      );
    } else {
      console.warn(`  WARN: Could not generate clean enum type for "${flagName}" — skipping`);
    }
  }

  const normals = normalize(raw);
  console.log(`Normalized ${normals.length} options`);

  const byCat: Record<string, number> = {};
  for (const n of normals) {
    byCat[n.cat] = (byCat[n.cat] || 0) + 1;
  }
  console.log("By category:", byCat);

  await mkdir(GENERATED_DIR, { recursive: true });

  const meta: any = JSON.parse(await readFile(JSON_PATH, "utf-8")).meta;

  const interfacesContent = generateInterfaces(normals, meta);
  await writeFile(join(GENERATED_DIR, "options.ts"), interfacesContent);
  console.log(`Wrote options.ts (${interfacesContent.length} chars, ${normals.length} options)`);

  const serializeContent = generateSerialize(normals, meta);
  await writeFile(join(GENERATED_DIR, "serialize.ts"), serializeContent);
  console.log(`Wrote serialize.ts (${serializeContent.length} chars)`);

  const generatedProps = new Set(normals.map((n) => n.prop));
  console.log(
    `\nGenerated ${generatedProps.size} unique properties across ${normals.length} entries`,
  );
  if (normals.length < 180) {
    console.warn(
      `WARNING: Low option count (${normals.length}) — check scraper data or exclude filter`,
    );
  }
}

void main();
