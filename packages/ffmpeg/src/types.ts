import type { FilterGraph } from "./filter-graph.ts";
import type {
  InputOptions as GeneratedInputOptions,
  InputStreamOptions as GeneratedInputStreamOptions,
  OutputOptions as GeneratedOutputOptions,
  OutputMetadataOptions as GeneratedOutputMetadataOptions,
  OutputStreamOptions as GeneratedOutputStreamOptions,
  GlobalOptions as GeneratedGlobalOptions,
  MetadataSpecifier,
} from "./generated/options.ts";
import type {
  DispositionValue,
  ForceKeyFramesValue,
  MetadataMapValue,
  MetadataValue,
  ProgramValue,
  StreamGroupValue,
  StreamIdValue,
} from "./structured.ts";

export type {
  Duration,
  Bitrate,
  FrameSize,
  Timestamp,
  FrameRate,
  Timecode,
  LogLevel,
  Vsync,
  Target,
  AspectRatio,
  PixelFormat,
  SampleFormat,
  ChannelLayout,
  SwsFlag,
  RawOptionBag,
  SerializedOptionScalar,
  SerializedOptionValue,
  StreamType,
  StreamSpecifier,
  StreamOptionBag,
  MetadataSpecifier,
  MetadataOptionBag,
} from "./generated/options.ts";
export type { OneOrMany, UnsafeValue } from "./structured.ts";

type StructuredOutputMetadataOptions = Omit<
  GeneratedOutputMetadataOptions,
  "metadata" | "mapMetadata"
> & {
  metadata?: MetadataValue;
  mapMetadata?: MetadataMapValue;
};

export type InputOptions = GeneratedInputOptions;
export type GlobalOptions = Omit<GeneratedGlobalOptions, "filterComplex"> & {
  filterComplex?: string | FilterGraph;
};
export type InputStreamOptions = GeneratedInputStreamOptions;
export type OutputStreamOptions = GeneratedOutputStreamOptions;
export type OutputMetadataOptions = StructuredOutputMetadataOptions;
export type OutputOptions = Omit<
  GeneratedOutputOptions,
  | "metadata"
  | "mapMetadata"
  | "disposition"
  | "forceKeyFrames"
  | "program"
  | "streamGroup"
  | "streamid"
  | "metadataScopes"
> & {
  metadata?: MetadataValue;
  mapMetadata?: MetadataMapValue;
  disposition?: DispositionValue;
  forceKeyFrames?: ForceKeyFramesValue;
  program?: ProgramValue;
  streamGroup?: StreamGroupValue;
  streamid?: StreamIdValue;
  metadataScopes?: Partial<Record<MetadataSpecifier, StructuredOutputMetadataOptions>>;
};
