import type { GlobalOptions, InputOptions, OutputOptions } from "./types.ts";

import { serializeGlobal, serializeInput, serializeOutput } from "./args.ts";
import { FilterGraph } from "./filter-graph.ts";
import {
  mapInputStream as serializeMapInputStream,
  mapLabel as serializeMapLabel,
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

  filterComplex(filter: string | { toString(): string }): this {
    this._global.filterComplex = String(filter);
    this._filterGraph = filter instanceof FilterGraph ? filter : null;
    return this;
  }

  map(mapTarget: string): this {
    const output = this.currentOutput();
    const existing = output.opts.map;
    if (Array.isArray(existing)) {
      existing.push(mapTarget);
    } else if (typeof existing === "string") {
      output.opts.map = [existing, mapTarget];
    } else {
      output.opts.map = [mapTarget];
    }
    return this;
  }

  mapInputStream(fileIndex: number, streamType?: MapStreamType, streamIndex?: number): this {
    return this.map(serializeMapInputStream(fileIndex, streamType, streamIndex));
  }

  mapLabel(label: string | { toString(): string }): this {
    return this.map(serializeMapLabel(String(label)));
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

export function ffmpeg(): FFmpegBuilder {
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
