import { isFunction, isObject, isString } from "@temelj/value";

import type { AudioContextLike } from "./context.ts";

import { AudioDisposedError, AudioRangeError, AudioUnsupportedError } from "../errors.ts";
import { AudioNodeUnit } from "../unit.ts";
import { getNativeAudioContext } from "./context.ts";

export type AudioWorkletMessageHandler<TMessage> = (message: TMessage, event: MessageEvent) => void;

export type AudioWorkletRequestOptions = {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
};

export type WorkletMessengerOptions = {
  readonly defaultRequestTimeoutMs?: number;
};

export type SingleIOWorkletParameterDescriptor = {
  readonly automationRate?: AutomationRate;
  readonly defaultValue?: number;
  readonly maxValue?: number;
  readonly minValue?: number;
  readonly name: string;
};

export type SingleIOWorkletModuleOptions = {
  readonly constructorSource?: string;
  readonly parameterDescriptors?: readonly SingleIOWorkletParameterDescriptor[];
  readonly processSource: string;
  readonly processorName: string;
};

export type RegisterSingleIOWorkletOptions = WorkletOptions & {
  readonly moduleSource?: SingleIOWorkletModuleOptions | string;
  readonly moduleUrl?: string | URL;
  readonly processorName: string;
};

export type WorkletEffectOptions = RegisterSingleIOWorkletOptions & {
  readonly channelCount?: number;
  readonly channelCountMode?: ChannelCountMode;
  readonly channelInterpretation?: ChannelInterpretation;
  readonly messenger?: WorkletMessengerOptions;
  readonly node?: Omit<AudioWorkletNodeOptions, "channelCount" | "processorName">;
  readonly parameterData?: Record<string, number>;
};

export async function addAudioWorkletModule(
  context: AudioContextLike,
  moduleUrl: string | URL,
  options?: WorkletOptions,
): Promise<void> {
  const nativeContext = getNativeAudioContext(context);
  const worklet = getSupportedAudioWorklet(nativeContext);
  await worklet.addModule(moduleUrl, options);
}

/**
 * Generates the source of an `AudioWorkletProcessor` module with one input and one output.
 * `processSource` becomes the body of `process(inputs, outputs, parameters)`. Register the result
 * with `registerSingleIOWorklet()`.
 *
 * @throws {AudioRangeError} When `processorName` is empty or only whitespace.
 */
export function createSingleIOWorkletModule(options: SingleIOWorkletModuleOptions): string {
  const processorName = assertWorkletProcessorName(options.processorName);
  const className = toWorkletClassName(processorName);
  const parameterDescriptors = JSON.stringify(options.parameterDescriptors ?? []);

  return `
class ${className} extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return ${parameterDescriptors};
  }

  constructor(options) {
    super();
${indentWorkletSource(options.constructorSource ?? "")}
  }

  process(inputs, outputs, parameters) {
${indentWorkletSource(options.processSource)}
  }
}
registerProcessor(${JSON.stringify(processorName)}, ${className});
`.trim();
}

export async function registerSingleIOWorklet(
  context: AudioContextLike,
  options: RegisterSingleIOWorkletOptions,
): Promise<string> {
  const nativeContext = getNativeAudioContext(context);
  getSupportedAudioWorklet(nativeContext);
  const processorName = assertWorkletProcessorName(options.processorName);
  const { credentials, moduleSource, moduleUrl } = options;
  const workletOptions = credentials === undefined ? undefined : { credentials };

  if (moduleUrl !== undefined) {
    await addAudioWorkletModule(nativeContext, moduleUrl, workletOptions);

    return processorName;
  }

  if (moduleSource === undefined) {
    return processorName;
  }

  const source = isString(moduleSource)
    ? moduleSource
    : createSingleIOWorkletModule({
        ...moduleSource,
        processorName,
      });

  const sourceUrl = createWorkletSourceUrl(source);

  try {
    await addAudioWorkletModule(nativeContext, sourceUrl, workletOptions);
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }

  return processorName;
}

type PendingRequest<TResponse> = {
  readonly resolve: (message: TResponse) => void;
  readonly reject: (reason?: unknown) => void;
};

/**
 * Typed message channel to an AudioWorklet processor, with request/response matching by `id`.
 */
export class WorkletMessenger<
  TIncoming = unknown,
  TOutgoing = TIncoming,
  TRequest extends { readonly id: string } = Extract<TOutgoing, { readonly id: string }>,
  TResponse extends { readonly id: string } = Extract<TIncoming, { readonly id: string }>,
> {
  readonly #port: MessagePort;
  readonly #options: WorkletMessengerOptions;
  readonly #listeners = new Set<AudioWorkletMessageHandler<TIncoming>>();
  readonly #pending = new Map<string, PendingRequest<TResponse>>();
  #disposed = false;

  constructor(port: MessagePort, options: WorkletMessengerOptions = {}) {
    this.#port = port;
    this.#options = options;
    port.addEventListener("message", this.#handleMessage);
    port.start();
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  send(message: TOutgoing, transfer?: Transferable[]): void {
    this.#assertOpen();

    if (transfer === undefined) {
      this.#port.postMessage(message);
    } else {
      this.#port.postMessage(message, transfer);
    }
  }

  /**
   * Sends `message` and resolves with the first incoming message that has the same `id`.
   *
   * @throws {DOMException} An `InvalidStateError` when a request with the same `id` is already
   * pending. Aborting `options.signal` rejects with an `AbortError`, and a response that misses the
   * timeout with a `TimeoutError`.
   */
  request(message: TRequest, options: AudioWorkletRequestOptions = {}): Promise<TResponse> {
    this.#assertOpen();
    const timeoutMs = options.timeoutMs ?? this.#options.defaultRequestTimeoutMs;
    const { signal } = options;

    return new Promise<TResponse>((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(createAbortError());

        return;
      }

      // A second request with the same id would take over the first one's response.
      if (this.#pending.has(message.id)) {
        reject(
          new DOMException(
            `audio worklet request ${message.id} is already pending`,
            "InvalidStateError",
          ),
        );

        return;
      }

      let timeout: ReturnType<typeof setTimeout> | undefined;

      const cleanup = (): void => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        this.#pending.delete(message.id);
      };

      const fail = (reason: unknown): void => {
        cleanup();
        reject(reason);
      };

      const abort = (): void => {
        fail(createAbortError());
      };

      if (timeoutMs !== undefined && Number.isFinite(timeoutMs) && timeoutMs >= 0) {
        timeout = setTimeout(() => {
          fail(new DOMException(`audio worklet request ${message.id} timed out`, "TimeoutError"));
        }, timeoutMs);
      }

      signal?.addEventListener("abort", abort, { once: true });
      this.#pending.set(message.id, {
        reject: fail,
        resolve: (response) => {
          cleanup();
          resolve(response);
        },
      });
      this.#port.postMessage(message);
    });
  }

  /**
   * Adds a handler for every incoming message. Returns an unsubscribe function.
   */
  onMessage(handler: AudioWorkletMessageHandler<TIncoming>): () => void {
    this.#assertOpen();
    this.#listeners.add(handler);

    return () => {
      this.#listeners.delete(handler);
    };
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;
    this.#listeners.clear();
    this.#port.removeEventListener("message", this.#handleMessage);

    for (const request of Array.from(this.#pending.values())) {
      request.reject(new AudioDisposedError("audio worklet messenger was disposed"));
    }
  }

  readonly #handleMessage = (event: MessageEvent): void => {
    const data: unknown = event.data;

    if (isMessageWithId(data)) {
      // SAFETY: an incoming message whose `id` matches a request is its response.
      this.#pending.get(data.id)?.resolve(data as TResponse);
    }

    // SAFETY: the processor posts `TIncoming` messages by contract.
    const message = data as TIncoming;

    for (const listener of this.#listeners) {
      listener(message, event);
    }
  };

  #assertOpen(): void {
    if (this.#disposed) {
      AudioDisposedError.disposed("audio worklet messenger");
    }
  }
}

/**
 * Single-input, single-output AudioWorklet node with a typed messenger. Create it with
 * `WorkletEffect.create()`, which registers the module first.
 */
export class WorkletEffect<
  TIncoming = unknown,
  TOutgoing = TIncoming,
  TRequest extends { readonly id: string } = Extract<TOutgoing, { readonly id: string }>,
  TResponse extends { readonly id: string } = Extract<TIncoming, { readonly id: string }>,
> extends AudioNodeUnit {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly node: AudioWorkletNode;
  readonly messenger: WorkletMessenger<TIncoming, TOutgoing, TRequest, TResponse>;

  constructor(
    context: AudioContextLike,
    node: AudioWorkletNode,
    messengerOptions: WorkletMessengerOptions = {},
  ) {
    super(context);
    this.node = this.nodes.add(node);
    this.input = this.createGain();
    this.output = this.createGain();
    this.messenger = new WorkletMessenger(node.port, messengerOptions);
    this.input.connect(node).connect(this.output);
  }

  static async create<
    TIncoming = unknown,
    TOutgoing = TIncoming,
    TRequest extends { readonly id: string } = Extract<TOutgoing, { readonly id: string }>,
    TResponse extends { readonly id: string } = Extract<TIncoming, { readonly id: string }>,
  >(
    context: AudioContextLike,
    options: WorkletEffectOptions,
  ): Promise<WorkletEffect<TIncoming, TOutgoing, TRequest, TResponse>> {
    const native = getNativeAudioContext(context);
    const processorName = await registerSingleIOWorklet(native, options);

    const node = createAudioWorkletNode(native, processorName, {
      ...options.node,
      channelCount: options.channelCount,
      channelCountMode: options.channelCountMode,
      channelInterpretation: options.channelInterpretation,
      numberOfInputs: options.node?.numberOfInputs ?? 1,
      numberOfOutputs: options.node?.numberOfOutputs ?? 1,
      outputChannelCount: options.node?.outputChannelCount ?? [options.channelCount ?? 2],
      parameterData: options.parameterData ?? options.node?.parameterData,
    });

    return new WorkletEffect(context, node, options.messenger);
  }

  protected override teardown(): void {
    this.messenger.dispose();
  }
}

/**
 * Returns the context's `audioWorklet`, which the Web Audio spec exposes only in secure contexts.
 *
 * @throws {AudioUnsupportedError} When the context has no `audioWorklet`.
 */
function getSupportedAudioWorklet(context: BaseAudioContext): AudioWorklet {
  return "audioWorklet" in context
    ? context.audioWorklet
    : AudioUnsupportedError.missingApi("AudioWorklet");
}

function createAudioWorkletNode(
  context: BaseAudioContext,
  processorName: string,
  options: AudioWorkletNodeOptions,
): AudioWorkletNode {
  if (!isFunction(globalThis.AudioWorkletNode)) {
    AudioUnsupportedError.missingApi("AudioWorkletNode");
  }

  return new AudioWorkletNode(context, processorName, options);
}

function createWorkletSourceUrl(source: string): string {
  if (!isFunction(globalThis.Blob) || !(URL.createObjectURL instanceof Function)) {
    AudioUnsupportedError.missingApi("URL.createObjectURL");
  }

  return URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
}

function assertWorkletProcessorName(name: string): string {
  if (name.trim() === "") {
    AudioRangeError.invalidOption("processorName", name);
  }

  return name;
}

function toWorkletClassName(processorName: string): string {
  const parts = processorName.split(/[^a-z\d]+/i).filter(Boolean);
  const name = parts.map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join("");

  return `Temelj${/^[A-Z]/.test(name) ? name : `Processor${name}`}Processor`;
}

function indentWorkletSource(source: string): string {
  if (source.trim() === "") {
    return "";
  }

  return source
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

function createAbortError(): DOMException {
  return new DOMException("the operation was aborted", "AbortError");
}

function isMessageWithId(value: unknown): value is { readonly id: string } {
  return isObject(value) && "id" in value && isString(value.id);
}
