export const DEFAULT_CONTEXT_LOOK_AHEAD = 0;

const AUTO_RESUME_EVENTS = ["pointerdown", "mousedown", "touchstart", "keydown"] as const;

const AUTO_UNLOCK_DELAY = 0.001;

export type OnlineAudioContextFacadeOptions = {
  readonly lookAhead?: number;
};

/**
 * Wrapper around a native audio context. `now()` returns the scheduling time including the
 * look-ahead, and `immediate()` returns the native `currentTime`.
 */
export abstract class AudioContextFacade {
  abstract get context(): BaseAudioContext;

  get currentTime(): number {
    return this.context.currentTime;
  }

  get destination(): AudioDestinationNode {
    return this.context.destination;
  }

  get sampleRate(): number {
    return this.context.sampleRate;
  }

  get state(): AudioContextState {
    return this.context.state;
  }

  immediate(): number {
    return this.context.currentTime;
  }

  now(): number {
    return this.context.currentTime;
  }

  abstract resume(): Promise<void>;
  abstract suspend(): Promise<void>;
  abstract close(): Promise<void>;
}

/**
 * Facade over a realtime `AudioContext`. It adds a scheduling look-ahead to `now()` and can resume
 * the context on the first user gesture (`enableAutoplayUnlock()`).
 */
export class OnlineAudioContextFacade extends AudioContextFacade {
  readonly #context: AudioContext;
  readonly #lookAhead: number;
  #autoplayUnsubscribers: (() => void)[] = [];
  #didUnlock = false;

  constructor(context: AudioContext, options: OnlineAudioContextFacadeOptions = {}) {
    super();
    this.#context = context;
    this.#lookAhead = options.lookAhead ?? DEFAULT_CONTEXT_LOOK_AHEAD;
  }

  get context(): AudioContext {
    return this.#context;
  }

  override now(): number {
    return this.#context.currentTime + this.#lookAhead;
  }

  async resume(): Promise<void> {
    if (this.#context.state === "closed") {
      return;
    }

    if (this.#context.state !== "running") {
      await this.#context.resume();
    }
  }

  async suspend(): Promise<void> {
    if (this.#context.state === "closed" || this.#context.state === "suspended") {
      return;
    }

    await this.#context.suspend();
  }

  async close(): Promise<void> {
    this.disableAutoplayUnlock();

    if (this.#context.state !== "closed") {
      await this.#context.close();
    }
  }

  /**
   * Waits for the first `pointerdown`, `mousedown`, `touchstart` or `keydown` on `target`, resumes
   * the context, and then plays a one-frame silent buffer.
   */
  enableAutoplayUnlock(target: EventTarget | undefined = globalThis.document): void {
    if (target === undefined || this.#autoplayUnsubscribers.length > 0) {
      return;
    }

    const handleGesture = (): void => {
      this.disableAutoplayUnlock();
      this.resume().then(
        () => {
          this.#playUnlockSample();
        },
        () => {
          // Resuming can fail when the gesture is not trusted; the next resume() retries.
        },
      );
    };

    for (const eventName of AUTO_RESUME_EVENTS) {
      target.addEventListener(eventName, handleGesture, { passive: true, once: true });
      this.#autoplayUnsubscribers.push(() => {
        target.removeEventListener(eventName, handleGesture);
      });
    }
  }

  disableAutoplayUnlock(): void {
    for (const unsubscribe of this.#autoplayUnsubscribers) {
      unsubscribe();
    }

    this.#autoplayUnsubscribers = [];
  }

  #playUnlockSample(): void {
    if (this.#didUnlock || this.#context.state !== "running") {
      return;
    }

    this.#didUnlock = true;

    const source = this.#context.createBufferSource();
    source.buffer = this.#context.createBuffer(1, 1, this.#context.sampleRate);
    source.connect(this.#context.destination);
    source.start(this.#context.currentTime + AUTO_UNLOCK_DELAY);
  }
}

/**
 * Facade over an `OfflineAudioContext`. `render()` starts rendering; `close()` does nothing because
 * offline contexts are released when rendering completes.
 */
export class OfflineAudioContextFacade extends AudioContextFacade {
  readonly #context: OfflineAudioContext;

  constructor(context: OfflineAudioContext) {
    super();
    this.#context = context;
  }

  get context(): OfflineAudioContext {
    return this.#context;
  }

  async resume(): Promise<void> {
    await this.#context.resume();
  }

  async suspend(): Promise<void> {
    await this.#context.suspend(this.#context.currentTime);
  }

  /**
   * Offline contexts cannot be closed; they are released once rendering completes.
   */
  async close(): Promise<void> {
    // Nothing to release.
  }

  render(): Promise<AudioBuffer> {
    return this.#context.startRendering();
  }
}
