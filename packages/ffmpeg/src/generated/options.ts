// auto-generated from ffmpeg-options.json — do not edit
// scraper run: 2026-05-30T17:50:52.551Z

export type Duration = string | number;
export type SerializedOptionScalar = string | number | boolean;
export type SerializedOptionValue = SerializedOptionScalar | readonly SerializedOptionScalar[];
export type RawOptionBag = Partial<Record<`-${string}`, SerializedOptionValue>>;
export type StreamType = "v" | "V" | "a" | "s" | "d" | "t";
export type StreamSpecifier =
  | StreamType
  | `${number}`
  | `${StreamType}:${number}`
  | `p:${number}`
  | `g:${number}`
  | `#${number}`
  | `i:${number}`
  | `m:${string}:${string}`
  | `disp:${string}`
  | "u";
export type StreamOptionBag<T> = Partial<Record<StreamSpecifier, T>>;
export type MetadataSpecifier = "g" | `s:${StreamSpecifier}` | `c:${number}` | `p:${number}`;
export type MetadataOptionBag<T> = Partial<Record<MetadataSpecifier, T>>;

export type Bitrate = `${number}k` | `${number}M` | `${number}G`;
export type FrameSize = `${number}x${number}`;
export type Timestamp =
  | number
  | `${number}`
  | `${number}ms`
  | `${number}us`
  | `${number}s`
  | `${number}m`
  | `${number}h`
  | `${number}:${number}`
  | `${number}:${number}:${number}`
  | `${number}:${number}:${number}.${number}`;
export type FrameRate =
  | number
  | `${number}`
  | `${number}/${number}`
  | "ntsc"
  | "pal"
  | "qntsc"
  | "qpal"
  | "sntsc"
  | "spal"
  | "film"
  | "ntsc-film";
export type Timecode =
  | `${number}:${number}:${number}:${number}`
  | `${number}:${number}:${number};${number}`;
export type LogLevel =
  | "quiet"
  | "panic"
  | "fatal"
  | "error"
  | "warning"
  | "info"
  | "verbose"
  | "debug"
  | "trace";
export type Vsync = "passthrough" | "cfr" | "vfr" | "drop" | "auto" | number;
export type Target =
  | "vcd"
  | "svcd"
  | "dvd"
  | "dv"
  | "dv50"
  | "pal-vcd"
  | "pal-svcd"
  | "pal-dvd"
  | "ntsc-vcd"
  | "ntsc-svcd"
  | "ntsc-dvd";
export type AspectRatio = `${number}:${number}` | `${number}/${number}` | number;
export type Preset =
  | "ultrafast"
  | "superfast"
  | "veryfast"
  | "faster"
  | "fast"
  | "medium"
  | "slow"
  | "slower"
  | "veryslow"
  | "placebo";
export type PixelFormat =
  | "yuv420p"
  | "yuvj420p"
  | "yuv422p"
  | "yuv444p"
  | "nv12"
  | "nv21"
  | "rgb24"
  | "bgr24"
  | "rgba"
  | "bgra"
  | "gray"
  | (string & Record<never, never>);
export type SampleFormat =
  | "u8"
  | "s16"
  | "s32"
  | "s64"
  | "flt"
  | "dbl"
  | "u8p"
  | "s16p"
  | "s32p"
  | "s64p"
  | "fltp"
  | "dblp"
  | (string & Record<never, never>);
export type ChannelLayout =
  | "mono"
  | "stereo"
  | "2.1"
  | "3.0"
  | "3.0(back)"
  | "3.1"
  | "4.0"
  | "quad"
  | "quad(side)"
  | "4.1"
  | "5.0"
  | "5.0(side)"
  | "5.1"
  | "5.1(side)"
  | "6.1"
  | "6.1(back)"
  | "7.0"
  | "7.0(front)"
  | "7.1"
  | "7.1(wide)"
  | "7.1(wide-side)"
  | "octagonal"
  | "hexagonal"
  | (string & Record<never, never>);
export type MovFlag =
  | "cmaf"
  | "dash"
  | "default_base_moof"
  | "delay_moov"
  | "disable_chpl"
  | "faststart"
  | "frag_custom"
  | "frag_discont"
  | "frag_every_frame"
  | "frag_keyframe"
  | "global_sidx"
  | "isml"
  | "negative_cts_offsets"
  | "omit_tfhd_offset"
  | "prefer_icc"
  | "rtphint"
  | "separate_moof"
  | "skip_sidx"
  | "skip_trailer"
  | "use_metadata_tags"
  | "write_colr"
  | "write_gama"
  | "hybrid_fragmented"
  | (string & Record<never, never>);
export type Strict =
  | "very"
  | "strict"
  | "normal"
  | "unofficial"
  | "experimental"
  | (string & Record<never, never>);
export type AvoidNegativeTs =
  | "make_non_negative"
  | "make_zero"
  | "auto"
  | "disabled"
  | (string & Record<never, never>);
export type ErrDetect =
  | "crccheck"
  | "bitstream"
  | "buffer"
  | "explode"
  | "ignore_err"
  | "careful"
  | "compliant"
  | "aggressive"
  | (string & Record<never, never>);
export type FFlags =
  | "discardcorrupt"
  | "fastseek"
  | "genpts"
  | "igndts"
  | "ignidx"
  | "nobuffer"
  | "nofillin"
  | "noparse"
  | "sortdts"
  | (string & Record<never, never>);
export type DefaultMode =
  | "infer"
  | "infer_no_subs"
  | "passthrough"
  | (string & Record<never, never>);
export type SwsFlag =
  | "fast_bilinear"
  | "bilinear"
  | "bicubic"
  | "experimental"
  | "neighbor"
  | "area"
  | "bicublin"
  | "gauss"
  | "sinc"
  | "lanczos"
  | "spline"
  | "print_info"
  | "accurate_rnd"
  | "full_chroma_int"
  | "full_chroma_inp"
  | "bitexact"
  | "unstable"
  | (string & Record<never, never>);

export interface InputOptions {
  /** Set the number of audio channels. For output streams it is set by */
  ac?: number;
  /** This option enables or disables accurate seeking in input files with the -ss option. It is enabled by default, so seekin */
  accurateSeek?: boolean;
  /** Set the audio codec. This is an alias for -codec:a . */
  acodec?: string;
  /** As an input option, blocks all audio streams of a file from being filtered or */
  an?: boolean;
  /** Automatically crop the video after decoding according to file metadata. */
  applyCropping?: "none" | "all" | "codec" | "container";
  /** Set the audio sampling frequency. For output streams it is set by */
  ar?: number;
  /** Enable bitexact mode for (de)muxer and (de/en)coder */
  bitExact?: boolean;
  /** Apply bitstream filters to matching streams. The filters are applied to each */
  bsf?: string;
  /** Select an encoder (when used before an output file) or a decoder (when used */
  c?: string;
  /** Set video content light metadata. */
  contentLight?: string;
  /** Specify how to set the encoder timebase when stream copying. mode is an */
  copyTb?: 1 | 0 | -1;
  /** Do not process input timestamps, but keep their values without trying */
  copyTs?: boolean;
  /** Allow input streams with unknown type to be copied instead of failing if copying */
  copyUnknown?: boolean;
  /** Allows discarding specific streams or frames from streams. */
  discard?: "none" | "default" | "noref" | "bidir" | "nokey" | "all";
  /** Set whether on display the image should be horizontally flipped. */
  displayHflip?: boolean;
  /** Set video rotation metadata. */
  displayRotation?: string;
  /** Set whether on display the image should be vertically flipped. */
  displayVflip?: boolean;
  /** As an input option, blocks all data streams of a file from being filtered or */
  dn?: boolean;
  /** This boolean option determines whether a frame with differing frame parameters mid-stream */
  dropChanged?: boolean;
  /** Timestamp discontinuity delta threshold, expressed as a decimal number */
  dtsDeltaThreshold?: number;
  /** Timestamp error delta threshold, expressed as a decimal number of */
  dtsErrorThreshold?: number;
  /** Extract the matching attachment stream into a file named filename . If filename is empty, then the value of the filename */
  dumpAttachment?: string;
  /** Error detection level */
  errDetect?: ErrDetect;
  /** Force input or output file format. The format is normally auto detected for input */
  f?: string;
  /** Format flags */
  fflags?: FFlags;
  /** Pass the hardware device called name to all filters in any filter graph. */
  filterHwDevice?: string;
  /** Set a specific output video stream as the heartbeat stream according to which */
  fixSubDurationHeartbeat?: string;
  /** If some input channel layout is not known, try to guess only if it */
  guessLayoutMax?: number;
  /** Use hardware acceleration to decode the matching stream(s). The allowed values */
  hwaccel?: "none" | "auto" | "vdpau" | "dxva2" | "d3d11va" | "vaapi" | "qsv" | "videotoolbox";
  /** Select a device to use for hardware acceleration. */
  hwaccelDevice?: string;
  /** input file url */
  i?: string;
  /** Ignore input streams with unknown type instead of failing if copying */
  ignoreUnknown?: boolean;
  /** Initialize hardware device */
  initHwDevice?: string;
  /** Assign an input as a sync source. */
  isync?: number;
  /** Set the input time offset. */
  itsoffset?: Timestamp;
  /** Rescale input timestamps. scale should be a floating point number. */
  itsscale?: number;
  /** Loop input (0=infinite) */
  loop?: number;
  /** Set video mastering display metadata. */
  masteringDisplay?: string;
  /** Set pixel format. Use -pix_fmts to show all the supported */
  pixFmt?: PixelFormat;
  /** Set frame rate (Hz value, fraction or abbreviation). */
  r?: FrameRate;
  /** Read input at native frame rate. This is equivalent to setting -readrate 1 . */
  re?: boolean;
  /** Limit input read speed. */
  readrate?: Timestamp;
  /** If either the input or output is blocked leading to actual read speed falling behind the */
  readrateCatchup?: Timestamp;
  /** Set an initial read burst time, in seconds, after which -re/-readrate will be enforced. */
  readrateInitialBurst?: Timestamp;
  /** This boolean option determines if the filtergraph(s) to which this stream is fed gets */
  reinitFilter?: boolean;
  /** Set frame size. */
  s?: FrameSize;
  /** This option enables or disables seeking by timestamp in input files with the -ss option. It is disabled by default. If e */
  seekTimestamp?: boolean;
  /** As an input option, blocks all subtitle streams of a file from being filtered or */
  sn?: boolean;
  /** When used as an input option (before -i ), seeks in this input file to position . Note that in most formats it is not po */
  ss?: Timestamp;
  /** Like the -ss option but relative to the "end of file". That is negative */
  sseof?: Timestamp;
  /** When used with copyts , shift input timestamps so they start at zero. */
  startAtZero?: boolean;
  /** Set number of times input stream shall be looped. Loop 0 means no loop, */
  streamLoop?: number;
  /** Set default flags for the libswscale library. These flags are used by */
  swsFlags?: SwsFlag;
  /** When used as an input option (before -i ), limit the duration of */
  t?: Timestamp;
  /** Force a tag/fourcc for matching streams. */
  tag?: string;
  /** For input, this option sets the maximum number of queued packets when reading */
  threadQueueSize?: number;
  /** Specify Timecode for writing. SEP is ’:’ for non drop timecode and ’;’ */
  timecode?: Timecode;
  /** Stop writing the output or reading the input at position . position must be a time duration specification, */
  to?: Timestamp;
  /** As an input option, blocks all video streams of a file from being filtered or */
  vn?: boolean;
  /** Stream-specifier scoped input options, serialized as flags like -r:v:0 or -hwaccel:a. */
  streams?: StreamOptionBag<InputStreamOptions>;
  /** Escape hatch for raw ffmpeg flags not modeled by this interface yet. Keys must be full CLI flags, e.g. "-metadata:s:v". */
  raw?: RawOptionBag;
}

export interface OutputOptions {
  /** Set the number of audio channels. For output streams it is set by */
  ac?: number;
  /** Set the audio codec. This is an alias for -codec:a . */
  acodec?: string;
  /** Create the filtergraph specified by filtergraph and use it to */
  af?: string;
  /** Set the number of audio frames to output. This is an obsolete alias for -frames:a , which you should use instead. */
  aframes?: number;
  /** As an input option, blocks all audio streams of a file from being filtered or */
  an?: boolean;
  /** Pad the output audio stream(s). This is the same as applying -af apad . */
  apad?: string;
  /** Set the audio quality (codec-specific, VBR). This is an alias for -q:a. */
  aq?: number;
  /** Set the audio sampling frequency. For output streams it is set by */
  ar?: number;
  /** Set the video display aspect ratio specified by aspect . */
  aspect?: AspectRatio;
  /** Force audio tag/fourcc. This is an alias for -tag:a . */
  atag?: string;
  /** Add an attachment to the output file. This is supported by a few formats */
  attach?: string;
  /** Audio bitrate (-b:a) */
  audioBitrate?: Bitrate;
  /** Audio codec (-c:a) */
  audioCodec?: string;
  /** Avoid negative timestamps */
  avoidNegativeTs?: AvoidNegativeTs;
  /** Declare the number of bits per raw sample in the given output stream to be value . Note that this option sets the inform */
  bitsPerRawSample?: number;
  /** Apply bitstream filters to matching streams. The filters are applied to each */
  bsf?: string;
  /** Set rate control buffer size */
  bufsize?: Bitrate;
  /** Select an encoder (when used before an output file) or a decoder (when used */
  c?: string;
  /** Set the size of the canvas used to render subtitles. */
  canvasSize?: FrameSize;
  /** Set the audio channel layout. For output streams it is set by default to the */
  channelLayout?: ChannelLayout;
  /** Alias for -channel_layout . */
  chLayout?: ChannelLayout;
  /** Select codec for stream */
  codec?: string;
  /** When doing stream copy, copy also non-key frames found at the */
  copyinkf?: boolean;
  /** Set CRF value (codec-specific) */
  crf?: number;
  /** Data codec (-c:d) */
  dataCodec?: string;
  /** Default stream selection mode */
  defaultMode?: DefaultMode;
  /** Set the number of data frames to output. This is an obsolete alias for -frames:d , which you should use instead. */
  dframes?: number;
  /** Sets the disposition flags for a stream. */
  disposition?: string | string[];
  /** As an input option, blocks all data streams of a file from being filtered or */
  dn?: boolean;
  /** Set the encoder timebase. timebase can assume one of the following values: */
  encTimeBase?: Duration;
  /** Force input or output file format. The format is normally auto detected for input */
  f?: string;
  /** Create the filtergraph specified by filtergraph and use it to */
  filter?: string;
  /** force_key_frames can take arguments of the following form: */
  forceKeyFrames?: string;
  /** Set maximum frame rate (Hz value, fraction or abbreviation). */
  fpsmax?: number;
  /** Stop writing to the stream after framecount frames. */
  frames?: number;
  /** Set the file size limit, expressed in bytes. No further chunk of bytes is written */
  fs?: number;
  /** Set codec level */
  level?: string;
  /** Create one or more streams in the output file. This option has two forms for */
  map?: string | string[];
  /** Copy chapters from input file with index input_file_index to the next */
  mapChapters?: string | string[];
  /** Set metadata information of the next output file from infile . Note that */
  mapMetadata?: string | string[];
  /** When transcoding audio and/or video streams, ffmpeg will not begin writing into */
  maxMuxingQueueSize?: number;
  /** Set max bitrate tolerance */
  maxrate?: Bitrate;
  /** Set a metadata key/value pair. */
  metadata?: string | string[];
  /** Set min bitrate tolerance */
  minrate?: Bitrate;
  /** Set mov/mp4 writing flags */
  movflags?: MovFlag;
  /** Set the maximum demux-decode delay. */
  muxdelay?: Timestamp;
  /** This is a minimum threshold until which the muxing queue size is not taken into */
  muxingQueueDataThreshold?: number;
  /** Set the initial demux-decode delay. */
  muxpreload?: Timestamp;
  /** Select the pass number (1 or 2). It is used to do two-pass */
  pass?: number;
  /** Set two-pass log file name prefix to prefix , the default file name */
  passLogfile?: string;
  /** Set pixel format. Use -pix_fmts to show all the supported */
  pixFmt?: PixelFormat;
  /** Specify the preset for matching stream(s). */
  pre?: string;
  /** Set codec preset */
  preset?: Preset;
  /** Set codec profile */
  profile?: string;
  /** Creates a program with the specified title , program_num and adds the specified stream (s) to it. */
  program?: string | string[];
  /** Use fixed quality scale (VBR). The meaning of q / qscale is */
  q?: number;
  /** Use fixed quality scale (VBR) */
  qscale?: number;
  /** Set frame rate (Hz value, fraction or abbreviation). */
  r?: FrameRate;
  /** Rate control override for specific intervals, formatted as "int,int,int" */
  rcOverride?: string;
  /** Set frame size. */
  s?: FrameSize;
  /** Set the audio sample format. Use -sample_fmts to get a list */
  sampleFmt?: SampleFormat;
  /** Set the subtitle codec. This is an alias for -codec:s . */
  scodec?: string;
  /** Finish encoding when the shortest output stream ends. */
  shortest?: boolean;
  /** The -shortest option may require buffering potentially large amounts */
  shortestBufDuration?: Timestamp;
  /** As an input option, blocks all subtitle streams of a file from being filtered or */
  sn?: boolean;
  /** When used as an input option (before -i ), seeks in this input file to position . Note that in most formats it is not po */
  ss?: Timestamp;
  /** Write per-frame encoding info post-encode */
  statsEncPost?: number;
  /** Format for stats_enc_post */
  statsEncPostFmt?: string;
  /** Write per-frame encoding information about the matching streams into the file */
  statsEncPre?: number;
  /** Specify the format for the lines written with -stats_enc_pre / -stats_enc_post / -stats_mux_pre . */
  statsEncPreFmt?: string;
  /** Creates a stream group of the specified type and stream_group_id , or by map ping an input group, adding the specified s */
  streamGroup?: string | string[];
  /** Assign a new stream-id value to an output stream. This option should be */
  streamid?: string | string[];
  /** Strict standard compliance */
  strict?: Strict;
  /** Subtitle bitrate (-b:s) */
  subtitleBitrate?: Bitrate;
  /** Subtitle codec (-c:s) */
  subtitleCodec?: string;
  /** Set default flags for the libswscale library. These flags are used by */
  swsFlags?: SwsFlag;
  /** When used as an input option (before -i ), limit the duration of */
  t?: Timestamp;
  /** Force a tag/fourcc for matching streams. */
  tag?: string;
  /** Specify target file type ( vcd , svcd , dvd , dv , dv50 ). type may be prefixed with pal- , ntsc- or film- to use the co */
  target?: Target;
  /** For input, this option sets the maximum number of queued packets when reading */
  threadQueueSize?: number;
  /** Set the recording timestamp in the container. */
  timestamp?: string;
  /** Stop writing the output or reading the input at position . position must be a time duration specification, */
  to?: Timestamp;
  /** Set codec tuning */
  tune?: string;
  /** Set the video codec. This is an alias for -codec:v . */
  vcodec?: string;
  /** Create the filtergraph specified by filtergraph and use it to */
  vf?: string;
  /** Set the number of video frames to output. This is an obsolete alias for -frames:v , which you should use instead. */
  vframes?: number;
  /** Video bitrate (-b:v) */
  videoBitrate?: Bitrate;
  /** Video codec (-c:v) */
  videoCodec?: string;
  /** As an input option, blocks all video streams of a file from being filtered or */
  vn?: boolean;
  /** Video quality (-q:v) */
  vq?: number;
  /** Dump video coding statistics to vstats_HHMMSS.log . See the vstats file format section for the format description. */
  vstats?: string;
  /** Dump video coding statistics to file . See the vstats file format section for the format description. */
  vstatsFile?: string;
  /** Specify which version of the vstats format to use. Default is 2 . See the vstats file format section for the format desc */
  vstatsVersion?: number;
  /** Force video tag/fourcc. This is an alias for -tag:v . */
  vtag?: string;
  /** Stream-specifier scoped output options, serialized as flags like -c:v:0 or -b:a. */
  streams?: StreamOptionBag<OutputStreamOptions>;
  /** Metadata-specifier scoped output options, serialized as flags like -metadata:s:v:0. */
  metadataScopes?: MetadataOptionBag<OutputMetadataOptions>;
  /** Escape hatch for raw ffmpeg flags not modeled by this interface yet. Keys must be full CLI flags, e.g. "-metadata:s:v". */
  raw?: RawOptionBag;
}

export interface GlobalOptions {
  /** Stop and abort on various conditions. The following flags are available: */
  abortOn?: "empty_output" | "empty_output_stream";
  /** Enable automatically inserting format conversion filters in all filter */
  autoConversionFilters?: boolean;
  /** Automatically rotate the video according to file metadata. Enabled by */
  autorotate?: boolean;
  /** Automatically scale the video according to the resolution of first frame. */
  autoscale?: boolean;
  /** Show benchmarking information at the end of an encode. */
  benchmark?: boolean;
  /** Show benchmarking information during the encode. */
  benchmarkAll?: boolean;
  /** Override detection of CPU count. This option is intended */
  cpucount?: number;
  /** Allows setting and clearing cpu flags. This option is intended */
  cpuflags?: string;
  /** Print timestamp/latency information. It is off by default. This option is */
  debugTs?: boolean;
  /** Dump each input packet to stderr. */
  dump?: boolean;
  /** Defines the maximum number of buffered frames allowed in a filtergraph. Under */
  filterBufferedFrames?: number;
  /** Define a complex filtergraph, i.e. one with arbitrary number of inputs and/or */
  filterComplex?: string;
  /** Defines how many threads are used to process a filter_complex graph. */
  filterComplexThreads?: number;
  /** Defines how many threads are used to process a filter pipeline. Each pipeline */
  filterThreads?: number;
  /** Fix subtitles durations. For each subtitle, wait for the next packet in the */
  fixSubDuration?: boolean;
  /** Frame drop threshold, which specifies how much behind video frames can */
  frameDropThreshold?: number;
  /** When dumping packets, also dump the payload. */
  hex?: boolean;
  /** Suppress printing banner. */
  hideBanner?: boolean;
  /** Define a complex filtergraph, i.e. one with arbitrary number of inputs and/or */
  lavfi?: string;
  /** Set logging level and flags used by the library. */
  loglevel?: LogLevel;
  /** Set fraction of decoding frame failures across all inputs which when crossed */
  maxErrorRate?: number;
  /** Do not overwrite output files, and exit immediately if a specified */
  n?: boolean;
  /** Do not overwrite output files */
  noOverwrite?: boolean;
  /** Disable encoding progress/statistics */
  noStats?: boolean;
  /** Disable interaction on standard input */
  noStdin?: boolean;
  /** Overwrite output files */
  overwrite?: boolean;
  /** Prints execution graph details to stderr in the format set via -print_graphs_format. */
  printGraphs?: boolean;
  /** Writes execution graph details to the specified file in the format set via -print_graphs_format. */
  printGraphsFile?: string;
  /** Sets the output format (available formats are: default, compact, csv, flat, ini, json, xml, mermaid, mermaidhtml) */
  printGraphsFormat?: string;
  /** Send program-friendly progress information to url . */
  progress?: string;
  /** Allow forcing a decoder of a different media type than the one */
  recastMedia?: boolean;
  /** Dump full command line and log output to a file named program - YYYYMMDD - HHMMSS .log in the current */
  report?: boolean;
  /** Print sdp information for an output stream to file . */
  sdpFile?: string;
  /** Log encoding progress/statistics as "info"-level log (see -loglevel ). */
  stats?: boolean;
  /** Set period at which encoding progress/statistics are updated. Default is 0.5 seconds. */
  statsPeriod?: Timestamp;
  /** Enable interaction on standard input. On by default unless standard input is */
  stdin?: boolean;
  /** Exit after ffmpeg has been running for duration seconds in CPU user time. */
  timelimit?: Timestamp;
  /** Set video sync method / framerate mode. vsync is applied to all output video streams */
  vsync?: Vsync;
  /** Stop and exit on error */
  xerror?: boolean;
  /** Overwrite output files without asking. */
  y?: boolean;
  /** Escape hatch for raw ffmpeg flags not modeled by this interface yet. Keys must be full CLI flags, e.g. "-metadata:s:v". */
  raw?: RawOptionBag;
}

export interface InputStreamOptions {
  ac?: number;
  applyCropping?: "none" | "all" | "codec" | "container";
  ar?: number;
  bsf?: string;
  c?: string;
  contentLight?: string;
  displayHflip?: boolean;
  displayRotation?: string;
  displayVflip?: boolean;
  dropChanged?: boolean;
  dumpAttachment?: string;
  guessLayoutMax?: number;
  hwaccel?: "none" | "auto" | "vdpau" | "dxva2" | "d3d11va" | "vaapi" | "qsv" | "videotoolbox";
  hwaccelDevice?: string;
  itsscale?: number;
  masteringDisplay?: string;
  pixFmt?: PixelFormat;
  r?: FrameRate;
  reinitFilter?: boolean;
  s?: FrameSize;
  tag?: string;
}

export interface OutputStreamOptions {
  ac?: number;
  apad?: string;
  aq?: number;
  ar?: number;
  aspect?: AspectRatio;
  audioBitrate?: Bitrate;
  audioCodec?: string;
  bitsPerRawSample?: number;
  bsf?: string;
  bufsize?: Bitrate;
  c?: string;
  channelLayout?: ChannelLayout;
  chLayout?: ChannelLayout;
  codec?: string;
  copyinkf?: boolean;
  crf?: number;
  dataCodec?: string;
  disposition?: string | string[];
  encTimeBase?: Duration;
  filter?: string;
  forceKeyFrames?: string;
  fpsmax?: number;
  frames?: number;
  level?: string;
  maxMuxingQueueSize?: number;
  maxrate?: Bitrate;
  minrate?: Bitrate;
  muxingQueueDataThreshold?: number;
  pass?: number;
  passLogfile?: string;
  pixFmt?: PixelFormat;
  pre?: string;
  preset?: Preset;
  profile?: string;
  q?: number;
  qscale?: number;
  r?: FrameRate;
  rcOverride?: string;
  s?: FrameSize;
  sampleFmt?: SampleFormat;
  statsEncPost?: number;
  statsEncPostFmt?: string;
  statsEncPre?: number;
  statsEncPreFmt?: string;
  subtitleBitrate?: Bitrate;
  subtitleCodec?: string;
  tag?: string;
  tune?: string;
  videoBitrate?: Bitrate;
  videoCodec?: string;
  vq?: number;
}

export interface OutputMetadataOptions {
  mapMetadata?: string | string[];
  metadata?: string | string[];
}
