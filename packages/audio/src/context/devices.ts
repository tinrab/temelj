import { isBoolean, isFunction, isObject, isString } from "@temelj/value";

import type { AudioContextLike } from "./context.ts";

import { AudioUnsupportedError } from "../errors.ts";
import { getNativeAudioContext } from "./context.ts";

const AUDIO_CONSTRAINT_KEYS = [
  "autoGainControl",
  "channelCount",
  "deviceId",
  "echoCancellation",
  "groupId",
  "latency",
  "noiseSuppression",
  "sampleRate",
  "sampleSize",
  "volume",
] as const;

export type AudioSinkNone = {
  readonly type: "none";
};

export type AudioContextSinkId = string | AudioSinkNone;

export type AudioDeviceChangeCallback = (event: Event) => void;

export type AudioDeviceKind = "audioinput" | "audiooutput";

export type AudioDeviceInventory = {
  readonly devices: readonly MediaDeviceInfo[];
  readonly inputs: readonly MediaDeviceInfo[];
  readonly outputs: readonly MediaDeviceInfo[];
};

export type AudioDeviceInventoryCallback = (
  inventory: AudioDeviceInventory,
  event: Event | undefined,
) => void | Promise<void>;

export type AudioDeviceInventoryWatchOptions = AudioDeviceChangeSubscriptionOptions & {
  readonly initial?: boolean;
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Device enumeration can throw any value; it is reported as-is.
  readonly onError?: (error: unknown) => void;
};

export type AudioConstraintKey = (typeof AUDIO_CONSTRAINT_KEYS)[number];

export type AudioDeviceChangeSubscriptionOptions = {
  readonly signal?: AbortSignal;
};

export type AudioInputStreamOptions = {
  readonly constraints?: boolean | MediaTrackConstraints;
  readonly deviceId?: string;
};

export type AudioInputStreamRequest = boolean | MediaTrackConstraints | AudioInputStreamOptions;

/**
 * Returns whether `navigator.mediaDevices.getUserMedia()` is available.
 */
export function isMediaStreamSupported(): boolean {
  return globalThis.navigator?.mediaDevices?.getUserMedia instanceof Function;
}

/**
 * Returns whether `navigator.mediaDevices.enumerateDevices()` is available.
 */
export function isMediaDeviceEnumerationSupported(): boolean {
  return globalThis.navigator?.mediaDevices?.enumerateDevices instanceof Function;
}

/**
 * Returns whether `navigator.mediaDevices.getSupportedConstraints()` is available.
 */
export function isMediaSupportedConstraintsSupported(): boolean {
  return globalThis.navigator?.mediaDevices?.getSupportedConstraints instanceof Function;
}

/**
 * Returns whether `navigator.mediaDevices` emits `devicechange` events.
 */
export function isAudioDeviceChangeSupported(): boolean {
  // SAFETY: listeners are typed optional so `mediaDevices` objects without them, such as test stubs, pass; they are checked before use.
  const mediaDevices = globalThis.navigator?.mediaDevices as
    | (MediaDevices & {
        readonly addEventListener?: unknown;
        readonly removeEventListener?: unknown;
      })
    | undefined;

  return isFunction(mediaDevices?.addEventListener) && isFunction(mediaDevices.removeEventListener);
}

/**
 * Returns whether `navigator.mediaDevices.selectAudioOutput()` is available.
 */
export function isAudioOutputSelectionSupported(): boolean {
  const mediaDevices = globalThis.navigator?.mediaDevices;

  return (
    mediaDevices !== undefined &&
    "selectAudioOutput" in mediaDevices &&
    isFunction(mediaDevices.selectAudioOutput)
  );
}

/**
 * Returns whether audio output can be routed to a chosen device with `setSinkId()`, on `context`
 * when given, otherwise on `AudioContext` in general.
 */
export function isAudioContextSinkSupported(context?: AudioContextLike): boolean {
  if (context !== undefined) {
    // SAFETY: `setSinkId` is missing in Firefox 158 and on offline contexts; it is checked before use.
    const nativeContext = getNativeAudioContext(context) as BaseAudioContext & {
      setSinkId?: unknown;
    };

    return isFunction(nativeContext.setSinkId);
  }

  // SAFETY: widens the constructor so a missing `setSinkId` reads as undefined.
  const AudioCtor = globalThis.AudioContext as
    | (typeof AudioContext & {
        readonly prototype?: { readonly setSinkId?: unknown };
      })
    | undefined;

  return isFunction(AudioCtor?.prototype?.setSinkId);
}

/**
 * Returns the output device id of `context`, or `undefined` when the runtime does not report one.
 */
export function getAudioContextSinkId(context: AudioContextLike): AudioContextSinkId | undefined {
  // SAFETY: `sinkId` is missing in Firefox 158 and on offline contexts; it is checked before use.
  const nativeContext = getNativeAudioContext(context) as BaseAudioContext & {
    readonly sinkId?: unknown;
  };

  return isAudioContextSinkId(nativeContext.sinkId) ? nativeContext.sinkId : undefined;
}

export async function setAudioContextSinkId(
  context: AudioContextLike,
  sinkId: AudioContextSinkId,
): Promise<void> {
  // SAFETY: `setSinkId` is missing in Firefox 158 and on offline contexts; it is checked before use.
  const nativeContext = getNativeAudioContext(context) as BaseAudioContext & {
    setSinkId?: (sinkId: AudioContextSinkId) => Promise<void>;
  };

  if (!isFunction(nativeContext.setSinkId)) {
    AudioUnsupportedError.missingApi("AudioContext.setSinkId");
  }

  await nativeContext.setSinkId(sinkId);
}

export async function selectAudioOutput(options?: {
  readonly deviceId?: string;
}): Promise<MediaDeviceInfo> {
  // SAFETY: `selectAudioOutput` is missing in Chromium 155; it is checked before use.
  const mediaDevices = globalThis.navigator?.mediaDevices as MediaDevices & {
    selectAudioOutput?: (options?: { readonly deviceId?: string }) => Promise<MediaDeviceInfo>;
  };

  if (!isFunction(mediaDevices?.selectAudioOutput)) {
    AudioUnsupportedError.missingApi("MediaDevices.selectAudioOutput");
  }

  return mediaDevices.selectAudioOutput(options);
}

export async function enumerateAudioDevices(kind?: AudioDeviceKind): Promise<MediaDeviceInfo[]> {
  const mediaDevices = globalThis.navigator?.mediaDevices;

  if (!(mediaDevices?.enumerateDevices instanceof Function)) {
    AudioUnsupportedError.missingApi("MediaDevices.enumerateDevices");
  }

  const devices = await mediaDevices.enumerateDevices();

  return devices.filter((device) => {
    if (device.kind !== "audioinput" && device.kind !== "audiooutput") {
      return false;
    }

    return kind === undefined || device.kind === kind;
  });
}

export async function getAudioDeviceInventory(): Promise<AudioDeviceInventory> {
  const devices = await enumerateAudioDevices();
  const inputs: MediaDeviceInfo[] = [];
  const outputs: MediaDeviceInfo[] = [];

  for (const device of devices) {
    if (device.kind === "audioinput") {
      inputs.push(device);
    } else {
      outputs.push(device);
    }
  }

  return { devices, inputs, outputs };
}

/**
 * Lists the audio input devices. Labels are empty until the user grants microphone access.
 *
 * @throws {AudioUnsupportedError} When device enumeration is not available.
 */
export function enumerateAudioInputDevices(): Promise<MediaDeviceInfo[]> {
  return enumerateAudioDevices("audioinput");
}

/**
 * Lists the audio output devices.
 *
 * @throws {AudioUnsupportedError} When device enumeration is not available.
 */
export function enumerateAudioOutputDevices(): Promise<MediaDeviceInfo[]> {
  return enumerateAudioDevices("audiooutput");
}

/**
 * Returns which audio track constraints the browser supports, or an empty object when it cannot
 * report them.
 */
export function getSupportedAudioConstraints(): Partial<Record<AudioConstraintKey, boolean>> {
  const mediaDevices = globalThis.navigator?.mediaDevices;

  if (!(mediaDevices?.getSupportedConstraints instanceof Function)) {
    return {};
  }

  // SAFETY: `MediaTrackSupportedConstraints` is a record of booleans keyed by constraint name.
  const supported = mediaDevices.getSupportedConstraints() as Record<string, boolean | undefined>;
  const constraints: Partial<Record<AudioConstraintKey, boolean>> = {};

  for (const key of AUDIO_CONSTRAINT_KEYS) {
    if (supported[key] === true) {
      constraints[key] = true;
    }
  }

  return constraints;
}

/**
 * Calls `callback` whenever audio devices are added or removed. Returns a function that
 * unsubscribes; aborting `options.signal` unsubscribes too.
 *
 * @throws {AudioUnsupportedError} When `devicechange` events are not available.
 */
export function onAudioDeviceChange(
  callback: AudioDeviceChangeCallback,
  options: AudioDeviceChangeSubscriptionOptions = {},
): () => void {
  // SAFETY: listeners are typed optional so `mediaDevices` objects without them, such as test stubs, pass; they are checked before use.
  const mediaDevices = globalThis.navigator?.mediaDevices as
    | (MediaDevices & {
        addEventListener?: (type: "devicechange", listener: EventListener) => void;
        removeEventListener?: (type: "devicechange", listener: EventListener) => void;
      })
    | undefined;

  if (
    !isFunction(mediaDevices?.addEventListener) ||
    !isFunction(mediaDevices.removeEventListener)
  ) {
    AudioUnsupportedError.missingApi("MediaDevices devicechange events");
  }

  if (options.signal?.aborted === true) {
    return () => undefined;
  }

  let disposed = false;
  const listener: EventListener = (event) => callback(event);

  const unsubscribe = () => {
    if (disposed) {
      return;
    }

    disposed = true;
    mediaDevices.removeEventListener?.("devicechange", listener);
    options.signal?.removeEventListener("abort", unsubscribe);
  };

  mediaDevices.addEventListener("devicechange", listener);
  options.signal?.addEventListener("abort", unsubscribe, { once: true });

  return unsubscribe;
}

/**
 * Calls `callback` with a fresh device inventory after each device change, and once right away when
 * `options.initial` is set. When changes overlap, only the newest inventory is reported. Errors
 * from enumeration or from `callback` go to `options.onError`. Returns a function that
 * unsubscribes.
 *
 * @throws {AudioUnsupportedError} When `devicechange` events are not available.
 */
export function onAudioDeviceInventoryChange(
  callback: AudioDeviceInventoryCallback,
  options: AudioDeviceInventoryWatchOptions = {},
): () => void {
  let disposed = false;
  let latest = 0;

  // Only the newest enumeration reports: an older one can resolve after a newer one, and nothing
  // reports once the watcher is disposed or its signal aborts.
  const isCurrent = (request: number): boolean =>
    !disposed && options.signal?.aborted !== true && request === latest;

  const notify = async (event?: Event) => {
    latest += 1;
    const request = latest;

    try {
      const inventory = await getAudioDeviceInventory();

      if (isCurrent(request)) {
        await callback(inventory, event);
      }
    } catch (error: unknown) {
      if (isCurrent(request)) {
        options.onError?.(error);
      }
    }
  };

  const unsubscribe = onAudioDeviceChange((event) => {
    void notify(event);
  }, options);

  if (options.initial === true) {
    void notify();
  }

  return () => {
    disposed = true;
    unsubscribe();
  };
}

export async function requestAudioInputStream(
  request: AudioInputStreamRequest = true,
): Promise<MediaStream> {
  const mediaDevices = globalThis.navigator?.mediaDevices;

  if (!(mediaDevices?.getUserMedia instanceof Function)) {
    AudioUnsupportedError.missingApi("MediaDevices.getUserMedia");
  }

  return mediaDevices.getUserMedia(createAudioInputConstraints(request));
}

/**
 * Builds the `getUserMedia()` constraints for an audio input request. `true` accepts any microphone
 * and track constraints pass through as given. Options with a `deviceId` require that exact device.
 */
export function createAudioInputConstraints(
  request: AudioInputStreamRequest = true,
): MediaStreamConstraints {
  if (isBoolean(request)) {
    return { audio: request };
  }

  if (isAudioInputStreamOptions(request)) {
    const { constraints, deviceId, ...inlineConstraints } = request;

    const baseConstraints = normalizeAudioTrackConstraints(
      constraints ?? (Object.keys(inlineConstraints).length > 0 ? inlineConstraints : true),
    );

    if (!isString(deviceId) || deviceId.length === 0) {
      return { audio: baseConstraints };
    }

    return {
      audio: isBoolean(baseConstraints)
        ? { deviceId: { exact: deviceId } }
        : {
            ...baseConstraints,
            deviceId: { exact: deviceId },
          },
    };
  }

  return { audio: request };
}

/**
 * Stops every track of `stream`, releasing the microphone or other capture device.
 */
export function stopMediaStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function isAudioContextSinkId(value: unknown): value is AudioContextSinkId {
  return isString(value) || (isObject(value) && "type" in value && value.type === "none");
}

function isAudioInputStreamOptions(
  value: MediaTrackConstraints | AudioInputStreamOptions,
): value is AudioInputStreamOptions {
  return "constraints" in value || ("deviceId" in value && isString(value.deviceId));
}

function normalizeAudioTrackConstraints(
  constraints: boolean | MediaTrackConstraints,
): boolean | MediaTrackConstraints {
  if (isBoolean(constraints)) {
    return constraints;
  }

  return { ...constraints };
}
