import type { FilterGraphStream } from "./filter-graph.ts";
import type { GlobalOptions, InputOptions, OutputOptions } from "./types.ts";

import { serializeGlobal, serializeInput, serializeOutput } from "./args.ts";
import { FilterGraph } from "./filter-graph.ts";
import {
  mapInputStream as serializeMapInputStream,
  mapLabel as serializeMapLabel,
  unsafeMapLabel as createUnsafeMapLabel,
  type MapStreamType,
} from "./mapping.ts";

export interface BuildResult {
  args: readonly string[];
}

interface InputEntry {
  path: string;
  opts: InputOptions;
}

interface OutputEntry {
  path: string;
  opts: OutputOptions;
}

export interface FFmpegStartBuilder {
  global(opts: GlobalOptions): FFmpegStartBuilder;
  input(path: string, opts?: InputOptions): FFmpegInputBuilder;
  output(path: string, opts?: OutputOptions): FFmpegOutputBuilder;
  filterComplex(filter: FilterGraph | string): FFmpegStartBuilder;
  build(): BuildResult;
  toArgs(): readonly string[];
  toCommandLine(): string;
}

export interface FFmpegInputBuilder {
  global(opts: GlobalOptions): FFmpegInputBuilder;
  input(path: string, opts?: InputOptions): FFmpegInputBuilder;
  seekInput(position: InputOptions["ss"]): FFmpegInputBuilder;
  inputDuration(duration: InputOptions["t"]): FFmpegInputBuilder;
  inputFormat(format: InputOptions["f"]): FFmpegInputBuilder;
  inputOptions(opts: InputOptions): FFmpegInputBuilder;
  output(path: string, opts?: OutputOptions): FFmpegReadyBuilder;
  filterComplex(filter: FilterGraph | string): FFmpegInputBuilder;
}

export interface FFmpegOutputBuilder {
  global(opts: GlobalOptions): FFmpegOutputBuilder;
  input(path: string, opts?: InputOptions): FFmpegReadyBuilder;
  output(path: string, opts?: OutputOptions): FFmpegOutputBuilder;
  videoCodec(codec: OutputOptions["videoCodec"]): FFmpegOutputBuilder;
  audioCodec(codec: OutputOptions["audioCodec"]): FFmpegOutputBuilder;
  subtitleCodec(codec: OutputOptions["subtitleCodec"]): FFmpegOutputBuilder;
  videoBitrate(bitrate: OutputOptions["videoBitrate"]): FFmpegOutputBuilder;
  audioBitrate(bitrate: OutputOptions["audioBitrate"]): FFmpegOutputBuilder;
  crf(value: OutputOptions["crf"]): FFmpegOutputBuilder;
  strict(value: OutputOptions["strict"]): FFmpegOutputBuilder;
  avoidNegativeTs(value: OutputOptions["avoidNegativeTs"]): FFmpegOutputBuilder;
  size(value: OutputOptions["s"]): FFmpegOutputBuilder;
  pixelFormat(value: OutputOptions["pixFmt"]): FFmpegOutputBuilder;
  videoFilter(value: OutputOptions["vf"]): FFmpegOutputBuilder;
  audioFilter(value: OutputOptions["af"]): FFmpegOutputBuilder;
  noVideo(): FFmpegOutputBuilder;
  noAudio(): FFmpegOutputBuilder;
  noSubtitle(): FFmpegOutputBuilder;
  outputOptions(opts: OutputOptions): FFmpegOutputBuilder;
  filterComplex(filter: FilterGraph | string): FFmpegOutputBuilder;
  map(mapTarget: string): FFmpegOutputBuilder;
  mapInputStream(
    fileIndex: number,
    streamType?: MapStreamType,
    streamIndex?: number,
  ): FFmpegOutputBuilder;
  mapLabel(label: FilterGraphStream): FFmpegOutputBuilder;
  unsafeMapLabel(label: string): FFmpegOutputBuilder;
  build(): BuildResult;
  toArgs(): readonly string[];
  toCommandLine(): string;
}

export interface FFmpegReadyBuilder extends FFmpegOutputBuilder {
  global(opts: GlobalOptions): FFmpegReadyBuilder;
  input(path: string, opts?: InputOptions): FFmpegReadyBuilder;
  seekInput(position: InputOptions["ss"]): FFmpegReadyBuilder;
  inputDuration(duration: InputOptions["t"]): FFmpegReadyBuilder;
  inputFormat(format: InputOptions["f"]): FFmpegReadyBuilder;
  inputOptions(opts: InputOptions): FFmpegReadyBuilder;
  output(path: string, opts?: OutputOptions): FFmpegReadyBuilder;
  filterComplex(filter: FilterGraph | string): FFmpegReadyBuilder;
  videoCodec(codec: OutputOptions["videoCodec"]): FFmpegReadyBuilder;
  audioCodec(codec: OutputOptions["audioCodec"]): FFmpegReadyBuilder;
  subtitleCodec(codec: OutputOptions["subtitleCodec"]): FFmpegReadyBuilder;
  videoBitrate(bitrate: OutputOptions["videoBitrate"]): FFmpegReadyBuilder;
  audioBitrate(bitrate: OutputOptions["audioBitrate"]): FFmpegReadyBuilder;
  crf(value: OutputOptions["crf"]): FFmpegReadyBuilder;
  strict(value: OutputOptions["strict"]): FFmpegReadyBuilder;
  avoidNegativeTs(value: OutputOptions["avoidNegativeTs"]): FFmpegReadyBuilder;
  size(value: OutputOptions["s"]): FFmpegReadyBuilder;
  pixelFormat(value: OutputOptions["pixFmt"]): FFmpegReadyBuilder;
  videoFilter(value: OutputOptions["vf"]): FFmpegReadyBuilder;
  audioFilter(value: OutputOptions["af"]): FFmpegReadyBuilder;
  noVideo(): FFmpegReadyBuilder;
  noAudio(): FFmpegReadyBuilder;
  noSubtitle(): FFmpegReadyBuilder;
  outputOptions(opts: OutputOptions): FFmpegReadyBuilder;
  map(mapTarget: string): FFmpegReadyBuilder;
  mapInputStream(
    fileIndex: number,
    streamType?: MapStreamType,
    streamIndex?: number,
  ): FFmpegReadyBuilder;
  mapLabel(label: FilterGraphStream): FFmpegReadyBuilder;
  unsafeMapLabel(label: string): FFmpegReadyBuilder;
  build(): BuildResult;
  toArgs(): readonly string[];
  toCommandLine(): string;
}

export class FFmpegBuilder {
  private _global: GlobalOptions = {};
  private _inputs: InputEntry[] = [];
  private _outputs: OutputEntry[] = [];
  private _filterGraph: FilterGraph | null = null;

  private currentInput(): InputEntry {
    const entry = this._inputs.at(-1);
    if (!entry) {
      throw new Error("No input defined. Call .input(...) before mutating input options.");
    }
    return entry;
  }

  private currentOutput(): OutputEntry {
    const entry = this._outputs.at(-1);
    if (!entry) {
      throw new Error("No output defined. Call .output(...) before mutating output options.");
    }
    return entry;
  }

  private as<TBuilder>(): TBuilder {
    return this as unknown as TBuilder;
  }

  global(
    opts: GlobalOptions,
  ): FFmpegStartBuilder | FFmpegInputBuilder | FFmpegOutputBuilder | FFmpegReadyBuilder {
    Object.assign(this._global, opts);
    return this.as();
  }

  input(path: string, opts: InputOptions = {}): FFmpegInputBuilder | FFmpegReadyBuilder {
    this._inputs.push({ path, opts });
    return this._outputs.length > 0 ? this.as<FFmpegReadyBuilder>() : this.as<FFmpegInputBuilder>();
  }

  seekInput(position: InputOptions["ss"]): FFmpegInputBuilder | FFmpegReadyBuilder {
    this.currentInput().opts.ss = position;
    return this.as();
  }

  inputDuration(duration: InputOptions["t"]): FFmpegInputBuilder | FFmpegReadyBuilder {
    this.currentInput().opts.t = duration;
    return this.as();
  }

  inputFormat(format: InputOptions["f"]): FFmpegInputBuilder | FFmpegReadyBuilder {
    this.currentInput().opts.f = format;
    return this.as();
  }

  inputOptions(opts: InputOptions): FFmpegInputBuilder | FFmpegReadyBuilder {
    Object.assign(this.currentInput().opts, opts);
    return this.as();
  }

  output(path: string, opts: OutputOptions = {}): FFmpegOutputBuilder | FFmpegReadyBuilder {
    this._outputs.push({ path, opts });
    return this._inputs.length > 0 ? this.as<FFmpegReadyBuilder>() : this.as<FFmpegOutputBuilder>();
  }

  videoCodec(codec: OutputOptions["videoCodec"]): FFmpegOutputBuilder | FFmpegReadyBuilder {
    this.currentOutput().opts.videoCodec = codec;
    return this.as();
  }

  audioCodec(codec: OutputOptions["audioCodec"]): FFmpegOutputBuilder | FFmpegReadyBuilder {
    this.currentOutput().opts.audioCodec = codec;
    return this.as();
  }

  subtitleCodec(codec: OutputOptions["subtitleCodec"]): FFmpegOutputBuilder | FFmpegReadyBuilder {
    this.currentOutput().opts.subtitleCodec = codec;
    return this.as();
  }

  videoBitrate(bitrate: OutputOptions["videoBitrate"]): FFmpegOutputBuilder | FFmpegReadyBuilder {
    this.currentOutput().opts.videoBitrate = bitrate;
    return this.as();
  }

  audioBitrate(bitrate: OutputOptions["audioBitrate"]): FFmpegOutputBuilder | FFmpegReadyBuilder {
    this.currentOutput().opts.audioBitrate = bitrate;
    return this.as();
  }

  crf(value: OutputOptions["crf"]): FFmpegOutputBuilder | FFmpegReadyBuilder {
    this.currentOutput().opts.crf = value;
    return this.as();
  }

  strict(value: OutputOptions["strict"]): FFmpegOutputBuilder | FFmpegReadyBuilder {
    this.currentOutput().opts.strict = value;
    return this.as();
  }

  avoidNegativeTs(
    value: OutputOptions["avoidNegativeTs"],
  ): FFmpegOutputBuilder | FFmpegReadyBuilder {
    this.currentOutput().opts.avoidNegativeTs = value;
    return this.as();
  }

  size(value: OutputOptions["s"]): FFmpegOutputBuilder | FFmpegReadyBuilder {
    this.currentOutput().opts.s = value;
    return this.as();
  }

  pixelFormat(value: OutputOptions["pixFmt"]): FFmpegOutputBuilder | FFmpegReadyBuilder {
    this.currentOutput().opts.pixFmt = value;
    return this.as();
  }

  videoFilter(value: OutputOptions["vf"]): FFmpegOutputBuilder | FFmpegReadyBuilder {
    this.currentOutput().opts.vf = value;
    return this.as();
  }

  audioFilter(value: OutputOptions["af"]): FFmpegOutputBuilder | FFmpegReadyBuilder {
    this.currentOutput().opts.af = value;
    return this.as();
  }

  noVideo(): FFmpegOutputBuilder | FFmpegReadyBuilder {
    this.currentOutput().opts.vn = true;
    return this.as();
  }

  noAudio(): FFmpegOutputBuilder | FFmpegReadyBuilder {
    this.currentOutput().opts.an = true;
    return this.as();
  }

  noSubtitle(): FFmpegOutputBuilder | FFmpegReadyBuilder {
    this.currentOutput().opts.sn = true;
    return this.as();
  }

  outputOptions(opts: OutputOptions): FFmpegOutputBuilder | FFmpegReadyBuilder {
    Object.assign(this.currentOutput().opts, opts);
    return this.as();
  }

  filterComplex(
    filter: FilterGraph | string,
  ): FFmpegStartBuilder | FFmpegInputBuilder | FFmpegOutputBuilder | FFmpegReadyBuilder {
    this._global.filterComplex = String(filter);
    this._filterGraph = filter instanceof FilterGraph ? filter : null;
    return this.as();
  }

  map(mapTarget: string): FFmpegOutputBuilder | FFmpegReadyBuilder {
    const output = this.currentOutput();
    const existing = output.opts.map;
    if (Array.isArray(existing)) {
      output.opts.map = [...existing, mapTarget];
    } else if (typeof existing === "string") {
      output.opts.map = [existing, mapTarget];
    } else {
      output.opts.map = [mapTarget];
    }
    return this.as();
  }

  mapInputStream(
    fileIndex: number,
    streamType?: MapStreamType,
    streamIndex?: number,
  ): FFmpegOutputBuilder | FFmpegReadyBuilder {
    return this.map(serializeMapInputStream(fileIndex, streamType, streamIndex));
  }

  mapLabel(label: FilterGraphStream): FFmpegOutputBuilder | FFmpegReadyBuilder {
    return this.map(serializeMapLabel(label));
  }

  unsafeMapLabel(label: string): FFmpegOutputBuilder | FFmpegReadyBuilder {
    return this.map(createUnsafeMapLabel(label).raw);
  }

  toArgs(): readonly string[] {
    return this.build().args;
  }

  toCommandLine(): string {
    const args = this.toArgs();
    return args.map(quoteShellArg).join(" ");
  }

  private validate(): void {
    if (this._outputs.length === 0 && this._inputs.length > 0) {
      throw new Error("No output defined. Call .output(...) before build().");
    }

    if (!this._filterGraph) {
      return;
    }

    for (const output of this._outputs) {
      const maps = output.opts.map;
      const values = maps === undefined ? [] : Array.isArray(maps) ? maps : [maps];
      for (const value of values) {
        if (!value.startsWith("[") || !value.endsWith("]")) continue;
        const label = value.slice(1, -1);
        if (!this._filterGraph.hasOutputLabel(label)) {
          throw new Error(
            `Mapped filter label "${label}" is not defined in the current filter graph`,
          );
        }
      }
    }
  }

  build(): BuildResult {
    this.validate();
    const args: string[] = [];

    args.push(...serializeGlobal(this._global));

    for (const entry of this._inputs) {
      args.push(...serializeInput(entry.opts));
      args.push("-i", entry.path);
    }

    for (const entry of this._outputs) {
      args.push(...serializeOutput(entry.opts));
      args.push(entry.path);
    }

    return { args };
  }
}

export function ffmpeg(): FFmpegStartBuilder {
  return new FFmpegBuilder() as FFmpegStartBuilder;
}

function quoteShellArg(value: string): string {
  if (value.length === 0) {
    return "''";
  }

  if (/^[A-Za-z0-9_./:[\]-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
}
