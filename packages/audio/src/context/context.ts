import { isString } from "@temelj/value";

import { AudioUnsupportedError } from "../errors.ts";
import { requireNonNegative } from "../validation.ts";
import {
  AudioContextFacade,
  DEFAULT_CONTEXT_LOOK_AHEAD,
  OfflineAudioContextFacade,
  OnlineAudioContextFacade,
} from "./facade.ts";

/**
 * Every API that needs a context accepts either a native context or a package facade. Facades add
 * `now()` with a scheduling look-ahead, plus `enableAutoplayUnlock()` on online contexts and
 * `render()` on offline ones; native contexts are used as-is.
 */
export type AudioContextLike = BaseAudioContext | AudioContextFacade;

export type CreateAudioContextOptions = AudioContextOptions & {
  /**
   * Resume the context on the first user gesture. Defaults to `true`.
   */
  readonly autoResume?: boolean;
  /**
   * Seconds that `now()` adds to the current time, so events scheduled at `now()` reach the audio
   * thread before they are due. Defaults to 0.
   */
  readonly lookAhead?: number;
};

export type WaitForAudioContextStateOptions = {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
};

export type AudioContextRunningCallback = (state: AudioContextState) => void;

/**
 * Returns whether the runtime defines `AudioContext`. Use it to guard `createAudioContext()` in
 * server-rendered code.
 */
export function isAudioContextSupported(): boolean {
  return globalThis.AudioContext !== undefined;
}

/**
 * Returns whether the runtime defines `OfflineAudioContext`.
 */
export function isOfflineAudioContextSupported(): boolean {
  return globalThis.OfflineAudioContext !== undefined;
}

/**
 * Creates an online context wrapped in a facade.
 *
 * @throws {AudioUnsupportedError} When the runtime has no `AudioContext`.
 */
export function createAudioContext(
  options: CreateAudioContextOptions = {},
): OnlineAudioContextFacade {
  if (!isAudioContextSupported()) {
    return AudioUnsupportedError.missingApi("AudioContext");
  }

  const { autoResume = true, lookAhead = DEFAULT_CONTEXT_LOOK_AHEAD, ...nativeOptions } = options;

  const facade = new OnlineAudioContextFacade(new AudioContext(nativeOptions), {
    lookAhead,
  });

  if (autoResume) {
    facade.enableAutoplayUnlock();
  }

  return facade;
}

/**
 * Creates an offline context wrapped in a facade.
 *
 * @throws {AudioUnsupportedError} When the runtime has no `OfflineAudioContext`.
 */
export function createOfflineAudioContext(
  options: OfflineAudioContextOptions,
): OfflineAudioContextFacade {
  if (!isOfflineAudioContextSupported()) {
    return AudioUnsupportedError.missingApi("OfflineAudioContext");
  }

  return new OfflineAudioContextFacade(new OfflineAudioContext(options));
}

/**
 * Returns the native context behind `context`: a facade's wrapped context, or `context` itself.
 */
export function getNativeAudioContext(context: AudioContextLike): BaseAudioContext {
  return context instanceof AudioContextFacade ? context.context : context;
}

/**
 * Returns the native `currentTime`.
 */
export function getAudioContextImmediateTime(context: AudioContextLike): number {
  return context instanceof AudioContextFacade ? context.immediate() : context.currentTime;
}

/**
 * Returns the default scheduling time, which includes a facade's look-ahead.
 */
export function getAudioContextNow(context: AudioContextLike): number {
  return context instanceof AudioContextFacade ? context.now() : context.currentTime;
}

function isOfflineContext(context: BaseAudioContext): context is OfflineAudioContext {
  return "startRendering" in context;
}

function isOnlineContext(context: BaseAudioContext): context is AudioContext {
  return "close" in context;
}

export async function resumeAudioContext(context: AudioContextLike): Promise<void> {
  if (context instanceof AudioContextFacade) {
    if (!(context instanceof OfflineAudioContextFacade)) {
      await context.resume();
    }

    return;
  }

  if (isOfflineContext(context) || !isOnlineContext(context)) {
    return;
  }

  if (context.state === "suspended") {
    await context.resume();
  }
}

export async function suspendAudioContext(context: AudioContextLike): Promise<void> {
  if (context instanceof AudioContextFacade) {
    await context.suspend();

    return;
  }

  if (isOfflineContext(context) || !isOnlineContext(context)) {
    return;
  }

  if (context.state === "running") {
    await context.suspend();
  }
}

export async function closeAudioContext(context: AudioContextLike): Promise<void> {
  if (context instanceof AudioContextFacade) {
    await context.close();

    return;
  }

  if (!isOfflineContext(context) && isOnlineContext(context) && context.state !== "closed") {
    await context.close();
  }
}

export async function decodeAudioData(
  context: AudioContextLike,
  data: ArrayBuffer,
): Promise<AudioBuffer> {
  return getNativeAudioContext(context).decodeAudioData(data);
}

// oxlint-disable-next-line anti-slop/no-unknown-returns -- Rejects with the caller's abort reason, which can be any value.
function createAbortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

function listenForStateChanges(context: AudioContextLike, listener: () => void): () => void {
  const nativeContext = getNativeAudioContext(context);
  nativeContext.addEventListener("statechange", listener);

  return () => {
    nativeContext.removeEventListener("statechange", listener);
  };
}

/**
 * Resolves with the context state once it is one of `state`, immediately if it already is.
 *
 * @throws {DOMException} An `AbortError` (or the signal's reason) when `options.signal` aborts, and
 * a `TimeoutError` after `options.timeoutMs`.
 */
export function waitForAudioContextState(
  context: AudioContextLike,
  state: AudioContextState | readonly AudioContextState[],
  options: WaitForAudioContextStateOptions = {},
): Promise<AudioContextState> {
  const states: readonly AudioContextState[] = isString(state) ? [state] : state;

  if (states.includes(context.state)) {
    return Promise.resolve(context.state);
  }

  const { signal, timeoutMs } = options;

  if (timeoutMs !== undefined) {
    requireNonNegative(timeoutMs, "timeoutMs");
  }

  if (signal?.aborted === true) {
    return Promise.reject(createAbortError(signal));
  }

  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      stopListening();
      signal?.removeEventListener("abort", handleAbort);

      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    };

    const handleStateChange = (): void => {
      if (states.includes(context.state)) {
        cleanup();
        resolve(context.state);
      }
    };

    const handleAbort = (): void => {
      cleanup();
      reject(signal === undefined ? undefined : createAbortError(signal));
    };

    const stopListening = listenForStateChanges(context, handleStateChange);
    signal?.addEventListener("abort", handleAbort, { once: true });

    if (timeoutMs !== undefined) {
      timeout = setTimeout(() => {
        cleanup();
        reject(
          new DOMException(
            `timed out waiting for AudioContext state: ${states.join(", ")}`,
            "TimeoutError",
          ),
        );
      }, timeoutMs);
    }
  });
}

/**
 * Invokes `callback` once the context is running. Offline contexts count as running.
 * Returns a function that cancels the pending callback.
 */
export function onAudioContextRunning(
  context: AudioContextLike,
  callback: AudioContextRunningCallback,
): () => void {
  if (context.state === "running" || isOfflineContext(getNativeAudioContext(context))) {
    callback(context.state);

    return () => {
      // Already invoked.
    };
  }

  const stopListening = listenForStateChanges(context, () => {
    if (context.state === "running") {
      stopListening();
      callback(context.state);
    }
  });

  return stopListening;
}
