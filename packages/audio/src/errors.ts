type StackFrameStart = CallableFunction | NewableFunction;

function captureErrorStack(error: Error, start: StackFrameStart): void {
  if ("captureStackTrace" in Error && Error.captureStackTrace instanceof Function) {
    Error.captureStackTrace(error, start);
  }
}

/**
 * Thrown when a number or option is not accepted, for example a value out of range or buffers whose
 * channel counts or sample rates do not match.
 */
export class AudioRangeError extends RangeError {
  constructor(message: string, options: ErrorOptions = {}, stackStart?: StackFrameStart) {
    super(message, options);
    this.name = "AudioRangeError";
    captureErrorStack(this, stackStart ?? AudioRangeError);
  }

  static notFinite(this: void, name: string, value: number): never {
    throw new AudioRangeError(
      `${name} must be a finite number, received ${value}`,
      {},
      AudioRangeError.notFinite,
    );
  }

  static notPositive(this: void, name: string, value: number): never {
    throw new AudioRangeError(
      `${name} must be a positive finite number, received ${value}`,
      {},
      AudioRangeError.notPositive,
    );
  }

  static negative(this: void, name: string, value: number): never {
    throw new AudioRangeError(
      `${name} must be a non-negative finite number, received ${value}`,
      {},
      AudioRangeError.negative,
    );
  }

  static notInteger(this: void, name: string, value: number): never {
    throw new AudioRangeError(
      `${name} must be an integer, received ${value}`,
      {},
      AudioRangeError.notInteger,
    );
  }

  static outOfRange(this: void, name: string, value: number, min: number, max: number): never {
    throw new AudioRangeError(
      `${name} must be within [${min}, ${max}], received ${value}`,
      {},
      AudioRangeError.outOfRange,
    );
  }

  static invalidRange(this: void, name: string, start: number, end: number): never {
    throw new AudioRangeError(
      `${name} start must be less than or equal to end, received ${start} > ${end}`,
      {},
      AudioRangeError.invalidRange,
    );
  }

  static invalidOption(this: void, name: string, value: unknown): never {
    throw new AudioRangeError(
      `${name} has an unsupported value: ${String(value)}`,
      {},
      AudioRangeError.invalidOption,
    );
  }

  static mismatch(this: void, name: string, expected: unknown, received: unknown): never {
    throw new AudioRangeError(
      `${name} mismatch: expected ${String(expected)}, received ${String(received)}`,
      {},
      AudioRangeError.mismatch,
    );
  }

  static empty(this: void, name: string): never {
    throw new AudioRangeError(`${name} must not be empty`, {}, AudioRangeError.empty);
  }
}

/**
 * Thrown when the runtime lacks a required Web Audio or media API.
 */
export class AudioUnsupportedError extends Error {
  constructor(message: string, options: ErrorOptions = {}, stackStart?: StackFrameStart) {
    super(message, options);
    this.name = "AudioUnsupportedError";
    captureErrorStack(this, stackStart ?? AudioUnsupportedError);
  }

  static missingApi(this: void, api: string): never {
    throw new AudioUnsupportedError(
      `${api} is not supported in this runtime`,
      {},
      AudioUnsupportedError.missingApi,
    );
  }
}

/**
 * Thrown when an operation is attempted on a disposed object.
 */
export class AudioDisposedError extends Error {
  constructor(message: string, options: ErrorOptions = {}, stackStart?: StackFrameStart) {
    super(message, options);
    this.name = "AudioDisposedError";
    captureErrorStack(this, stackStart ?? AudioDisposedError);
  }

  static disposed(this: void, subject: string): never {
    throw new AudioDisposedError(
      `cannot use a disposed ${subject}`,
      {},
      AudioDisposedError.disposed,
    );
  }
}

/**
 * Thrown when a graph cannot be built as described, for example from a malformed preset or an
 * invalid route. Lookups by name that find nothing, such as an unknown sprite or player, throw it
 * too.
 */
export class AudioGraphError extends Error {
  constructor(message: string, options: ErrorOptions = {}, stackStart?: StackFrameStart) {
    super(message, options);
    this.name = "AudioGraphError";
    captureErrorStack(this, stackStart ?? AudioGraphError);
  }

  static unknownBlueprintType(this: void, type: string): never {
    throw new AudioGraphError(
      `unknown blueprint type "${type}"`,
      {},
      AudioGraphError.unknownBlueprintType,
    );
  }

  static blueprintNotInPatch(this: void, type: string): never {
    throw new AudioGraphError(
      `blueprint "${type}" is not part of this patch playback`,
      {},
      AudioGraphError.blueprintNotInPatch,
    );
  }

  static emptyChain(this: void): never {
    throw new AudioGraphError("chain requires at least one node", {}, AudioGraphError.emptyChain);
  }

  static duplicateNode(this: void, id: string): never {
    throw new AudioGraphError(`duplicate graph node id "${id}"`, {}, AudioGraphError.duplicateNode);
  }

  static invalidRoute(this: void, reason: string): never {
    throw new AudioGraphError(`invalid audio route: ${reason}`, {}, AudioGraphError.invalidRoute);
  }

  static missingNode(this: void, id: string): never {
    throw new AudioGraphError(`graph node "${id}" was not found`, {}, AudioGraphError.missingNode);
  }

  static missingParam(this: void, id: string, param: string): never {
    throw new AudioGraphError(
      `graph node "${id}" has no param "${param}"`,
      {},
      AudioGraphError.missingParam,
    );
  }

  static missingResource(this: void, kind: string, id: string): never {
    throw new AudioGraphError(`${kind} "${id}" was not found`, {}, AudioGraphError.missingResource);
  }

  static invalidPreset(this: void, options: ErrorOptions = {}): never {
    throw new AudioGraphError("invalid graph preset", options, AudioGraphError.invalidPreset);
  }

  static missingNodeOption(this: void, id: string, option: string): never {
    throw new AudioGraphError(
      `cannot hydrate graph node "${id}" without "${option}"`,
      {},
      AudioGraphError.missingNodeOption,
    );
  }

  static notSerializable(this: void, path: string): never {
    throw new AudioGraphError(
      `${path} must be JSON-serializable`,
      {},
      AudioGraphError.notSerializable,
    );
  }
}

/**
 * Thrown when audio cannot be loaded, for example when a fetch returns an error status or no source
 * candidate has a playable format. A single candidate that fails to decode rejects with the error
 * from `decodeAudioData()` instead.
 */
export class AudioLoadError extends Error {
  constructor(message: string, options: ErrorOptions = {}, stackStart?: StackFrameStart) {
    super(message, options);
    this.name = "AudioLoadError";
    captureErrorStack(this, stackStart ?? AudioLoadError);
  }

  static fetchFailed(this: void, source: string, status: number): never {
    throw new AudioLoadError(
      `failed to fetch audio from ${source}: HTTP ${status}`,
      {},
      AudioLoadError.fetchFailed,
    );
  }

  static noCandidates(this: void): never {
    throw new AudioLoadError(
      "audio source candidate list is empty",
      {},
      AudioLoadError.noCandidates,
    );
  }

  static allCandidatesFailed(this: void, errors: readonly unknown[]): never {
    throw new AudioLoadError(
      "failed to load every audio source candidate",
      { cause: new AggregateError(errors) },
      AudioLoadError.allCandidatesFailed,
    );
  }

  static unsupportedFormat(this: void, source: string): never {
    throw new AudioLoadError(
      `unsupported audio format: ${source}`,
      {},
      AudioLoadError.unsupportedFormat,
    );
  }
}
