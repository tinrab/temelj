export type FilterGraphMediaType = "video" | "audio" | "unknown";

export type FilterScalar = string | number | boolean;

export type FilterNamedOptions = Record<string, FilterScalar | undefined>;

export interface FilterNodeSpec {
  name: string;
  positional?: readonly FilterScalar[];
  named?: FilterNamedOptions;
}

export interface TrimOptions {
  start?: string | number;
  end?: string | number;
  duration?: string | number;
  startFrame?: number;
  endFrame?: number;
}

export interface OverlayOptions {
  x?: string | number;
  y?: string | number;
  eofAction?: string;
  shortest?: boolean;
  repeatlast?: boolean;
}

export interface AmixOptions {
  inputs?: number;
  duration?: string;
  dropoutTransition?: number;
  normalize?: boolean;
}

export interface ConcatOptions {
  segments: number;
  videoStreams?: number;
  audioStreams?: number;
  unsafe?: boolean;
}

function escapeFilterValue(value: FilterScalar): string {
  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }

  return String(value);
}

function serializeFilter(spec: FilterNodeSpec): string {
  const parts: string[] = [];

  if (spec.positional && spec.positional.length > 0) {
    parts.push(spec.positional.map(escapeFilterValue).join(":"));
  }

  if (spec.named) {
    const entries = Object.entries(spec.named)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${escapeFilterValue(value as FilterScalar)}`);

    if (entries.length > 0) {
      parts.push(...entries);
    }
  }

  if (parts.length === 0) {
    return spec.name;
  }

  return `${spec.name}=${parts.join(":")}`;
}

function joinInputs(inputs: readonly FilterGraphStream[]): string {
  return inputs.map((stream) => stream.toString()).join("");
}

function joinOutputs(outputs: readonly string[]): string {
  return outputs.map((label) => `[${label}]`).join("");
}

let autoLabelId = 0;

function nextAutoLabel(prefix: string): string {
  const label = `${prefix}${autoLabelId}`;
  autoLabelId += 1;
  return label;
}

export function resetFilterGraphLabelCounter(): void {
  autoLabelId = 0;
}

export class FilterGraphStream {
  public readonly label: string;
  public readonly mediaType: FilterGraphMediaType;

  constructor(label: string, mediaType: FilterGraphMediaType) {
    this.label = label;
    this.mediaType = mediaType;
  }

  toString(): string {
    return `[${this.label}]`;
  }
}

class FilterGraphChain {
  private readonly filters: string[] = [];
  private readonly graph: FilterGraph;
  private readonly inputs: readonly FilterGraphStream[];
  private readonly outputMediaTypes: readonly FilterGraphMediaType[];

  constructor(
    graph: FilterGraph,
    inputs: readonly FilterGraphStream[],
    outputMediaTypes: readonly FilterGraphMediaType[],
  ) {
    this.graph = graph;
    this.inputs = inputs;
    this.outputMediaTypes = outputMediaTypes;
  }

  raw(filter: string): this {
    this.filters.push(filter);
    return this;
  }

  filter(
    name: string,
    positional: readonly FilterScalar[] = [],
    named: FilterNamedOptions = {},
  ): this {
    this.filters.push(serializeFilter({ name, positional, named }));
    return this;
  }

  scale(width: string | number, height: string | number, named: FilterNamedOptions = {}): this {
    return this.filter("scale", [width, height], named);
  }

  fps(rate: string | number): this {
    return this.filter("fps", [rate]);
  }

  format(pixelFormat: string): this {
    return this.filter("format", [pixelFormat]);
  }

  trim(options: TrimOptions): this {
    return this.filter("trim", [], {
      start: options.start,
      end: options.end,
      duration: options.duration,
      start_frame: options.startFrame,
      end_frame: options.endFrame,
    });
  }

  setpts(expression: string): this {
    return this.filter("setpts", [expression]);
  }

  asetpts(expression: string): this {
    return this.filter("asetpts", [expression]);
  }

  hflip(): this {
    return this.filter("hflip");
  }

  vflip(): this {
    return this.filter("vflip");
  }

  volume(value: string | number): this {
    return this.filter("volume", [value]);
  }

  atempo(value: number): this {
    return this.filter("atempo", [value]);
  }

  split(...labels: string[]): FilterGraphStream[] {
    const outputLabels = labels.length > 0 ? labels : [nextAutoLabel("v"), nextAutoLabel("v")];

    return this.commit(
      outputLabels,
      outputLabels.map(() => this.outputMediaTypes[0] ?? "unknown"),
      serializeFilter({ name: "split", named: { outputs: outputLabels.length } }),
    );
  }

  asplit(...labels: string[]): FilterGraphStream[] {
    const outputLabels = labels.length > 0 ? labels : [nextAutoLabel("a"), nextAutoLabel("a")];

    return this.commit(
      outputLabels,
      outputLabels.map(() => "audio"),
      serializeFilter({ name: "asplit", named: { outputs: outputLabels.length } }),
    );
  }

  label(label: string): FilterGraphStream {
    return this.commit([label], [this.outputMediaTypes[0] ?? "unknown"])[0];
  }

  labels(...labels: string[]): FilterGraphStream[] {
    const outputLabels = labels.length > 0 ? labels : [nextAutoLabel("out")];
    return this.commit(
      outputLabels,
      outputLabels.map(
        (_, index) => this.outputMediaTypes[index] ?? this.outputMediaTypes[0] ?? "unknown",
      ),
    );
  }

  autoLabel(prefix?: string): FilterGraphStream {
    const mediaType = this.outputMediaTypes[0] ?? "unknown";
    const fallbackPrefix =
      prefix ?? (mediaType === "audio" ? "a" : mediaType === "video" ? "v" : "out");
    return this.label(nextAutoLabel(fallbackPrefix));
  }

  private commit(
    labels: readonly string[],
    outputMediaTypes: readonly FilterGraphMediaType[],
    terminalFilter?: string,
  ): FilterGraphStream[] {
    const chain = [...this.filters];
    if (terminalFilter) {
      chain.push(terminalFilter);
    }

    if (chain.length === 0) {
      throw new Error("Cannot label an empty filter graph chain");
    }

    this.graph.addSegment(
      `${joinInputs(this.inputs)}${chain.join(",")}${joinOutputs(labels)}`,
      labels,
    );

    return labels.map(
      (label, index) => new FilterGraphStream(label, outputMediaTypes[index] ?? "unknown"),
    );
  }
}

export class FilterGraph {
  private readonly segments: string[] = [];
  private readonly outputLabels = new Set<string>();

  addSegment(segment: string, labels: readonly string[]): void {
    for (const label of labels) {
      if (this.outputLabels.has(label)) {
        throw new Error(`Duplicate filter graph output label "${label}"`);
      }
      this.outputLabels.add(label);
    }
    this.segments.push(segment);
  }

  hasOutputLabel(label: string): boolean {
    return this.outputLabels.has(label);
  }

  getOutputLabels(): string[] {
    return [...this.outputLabels];
  }

  input(
    index: number,
    streamType?: "v" | "a" | "s" | "d" | "t",
    streamIndex?: number,
  ): FilterGraphStream {
    const label =
      streamType === undefined
        ? String(index)
        : streamIndex === undefined
          ? `${index}:${streamType}`
          : `${index}:${streamType}:${streamIndex}`;

    const mediaType: FilterGraphMediaType =
      streamType === "v" ? "video" : streamType === "a" ? "audio" : "unknown";

    return new FilterGraphStream(label, mediaType);
  }

  videoInput(index: number, streamIndex?: number): FilterGraphChain {
    return new FilterGraphChain(this, [this.input(index, "v", streamIndex)], ["video"]);
  }

  audioInput(index: number, streamIndex?: number): FilterGraphChain {
    return new FilterGraphChain(this, [this.input(index, "a", streamIndex)], ["audio"]);
  }

  from(...streams: readonly FilterGraphStream[]): FilterGraphChain {
    const mediaType = streams[0]?.mediaType ?? "unknown";
    return new FilterGraphChain(this, streams, [mediaType]);
  }

  overlay(
    main: FilterGraphStream,
    overlay: FilterGraphStream,
    options: OverlayOptions = {},
  ): FilterGraphChain {
    return new FilterGraphChain(this, [main, overlay], ["video"]).filter("overlay", [], {
      x: options.x,
      y: options.y,
      eof_action: options.eofAction,
      shortest: options.shortest,
      repeatlast: options.repeatlast,
    });
  }

  amerge(...streams: readonly FilterGraphStream[]): FilterGraphChain {
    return new FilterGraphChain(this, streams, ["audio"]).filter("amerge", [], {
      inputs: streams.length,
    });
  }

  amix(streams: readonly FilterGraphStream[], options: AmixOptions = {}): FilterGraphChain {
    return new FilterGraphChain(this, streams, ["audio"]).filter("amix", [], {
      inputs: options.inputs ?? streams.length,
      duration: options.duration,
      dropout_transition: options.dropoutTransition,
      normalize: options.normalize,
    });
  }

  concat(streams: readonly FilterGraphStream[], options: ConcatOptions): FilterGraphChain {
    const outputMediaTypes: FilterGraphMediaType[] = [];

    const videoStreams = options.videoStreams ?? 1;
    const audioStreams = options.audioStreams ?? 0;

    for (let index = 0; index < videoStreams; index += 1) {
      outputMediaTypes.push("video");
    }

    for (let index = 0; index < audioStreams; index += 1) {
      outputMediaTypes.push("audio");
    }

    return new FilterGraphChain(
      this,
      streams,
      outputMediaTypes.length > 0 ? outputMediaTypes : ["unknown"],
    ).filter("concat", [], {
      n: options.segments,
      v: videoStreams,
      a: audioStreams,
      unsafe: options.unsafe,
    });
  }

  toString(): string {
    return this.segments.join(";");
  }
}

export function filterGraph(): FilterGraph {
  return new FilterGraph();
}
