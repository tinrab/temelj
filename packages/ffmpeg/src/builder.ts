import type { FilterGraphStream } from "./filter-graph.ts";
import type { GlobalOptions, InputOptions, OutputOptions } from "./types.ts";

import { serializeGlobal, serializeInput, serializeOutput } from "./args.ts";
import { FFmpegDefinitionError } from "./errors.ts";
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
      FFmpegDefinitionError.inputMissing();
    }

    return entry;
  }

  private currentOutput(): OutputEntry {
    const entry = this._outputs.at(-1);

    if (!entry) {
      FFmpegDefinitionError.outputMissing();
    }

    return entry;
  }

  global(opts: GlobalOptions): this {
    Object.assign(this._global, opts);

    return this;
  }

  input(path: string, opts: InputOptions = {}): this {
    this._inputs.push({ path, opts });

    return this;
  }

  seekInput(position: InputOptions["ss"]): this {
    this.currentInput().opts.ss = position;

    return this;
  }

  inputDuration(duration: InputOptions["t"]): this {
    this.currentInput().opts.t = duration;

    return this;
  }

  inputFormat(format: InputOptions["f"]): this {
    this.currentInput().opts.f = format;

    return this;
  }

  inputOptions(opts: InputOptions): this {
    Object.assign(this.currentInput().opts, opts);

    return this;
  }

  output(path: string, opts: OutputOptions = {}): this {
    this._outputs.push({ path, opts });

    return this;
  }

  videoCodec(codec: OutputOptions["videoCodec"]): this {
    this.currentOutput().opts.videoCodec = codec;

    return this;
  }

  audioCodec(codec: OutputOptions["audioCodec"]): this {
    this.currentOutput().opts.audioCodec = codec;

    return this;
  }

  subtitleCodec(codec: OutputOptions["subtitleCodec"]): this {
    this.currentOutput().opts.subtitleCodec = codec;

    return this;
  }

  videoBitrate(bitrate: OutputOptions["videoBitrate"]): this {
    this.currentOutput().opts.videoBitrate = bitrate;

    return this;
  }

  audioBitrate(bitrate: OutputOptions["audioBitrate"]): this {
    this.currentOutput().opts.audioBitrate = bitrate;

    return this;
  }

  crf(value: OutputOptions["crf"]): this {
    this.currentOutput().opts.crf = value;

    return this;
  }

  strict(value: OutputOptions["strict"]): this {
    this.currentOutput().opts.strict = value;

    return this;
  }

  avoidNegativeTs(value: OutputOptions["avoidNegativeTs"]): this {
    this.currentOutput().opts.avoidNegativeTs = value;

    return this;
  }

  size(value: OutputOptions["s"]): this {
    this.currentOutput().opts.s = value;

    return this;
  }

  pixelFormat(value: OutputOptions["pixFmt"]): this {
    this.currentOutput().opts.pixFmt = value;

    return this;
  }

  videoFilter(value: OutputOptions["vf"]): this {
    this.currentOutput().opts.vf = value;

    return this;
  }

  audioFilter(value: OutputOptions["af"]): this {
    this.currentOutput().opts.af = value;

    return this;
  }

  noVideo(): this {
    this.currentOutput().opts.vn = true;

    return this;
  }

  noAudio(): this {
    this.currentOutput().opts.an = true;

    return this;
  }

  noSubtitle(): this {
    this.currentOutput().opts.sn = true;

    return this;
  }

  outputOptions(opts: OutputOptions): this {
    Object.assign(this.currentOutput().opts, opts);

    return this;
  }

  filterComplex(filter: FilterGraph | string): this {
    this._global.filterComplex = String(filter);
    this._filterGraph = filter instanceof FilterGraph ? filter : null;

    return this;
  }

  map(mapTarget: string): this {
    const output = this.currentOutput();
    const existing = output.opts.map;

    if (Array.isArray(existing)) {
      output.opts.map = [...existing, mapTarget];
    } else if (existing !== undefined) {
      output.opts.map = [existing, mapTarget];
    } else {
      output.opts.map = [mapTarget];
    }

    return this;
  }

  mapInputStream(fileIndex: number, streamType?: MapStreamType, streamIndex?: number): this {
    return this.map(serializeMapInputStream(fileIndex, streamType, streamIndex));
  }

  mapLabel(label: FilterGraphStream): this {
    return this.map(serializeMapLabel(label));
  }

  unsafeMapLabel(label: string): this {
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
      FFmpegDefinitionError.buildOutputMissing();
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
          FFmpegDefinitionError.mappedFilterLabelMissing(label);
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
  return new FFmpegBuilder();
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
