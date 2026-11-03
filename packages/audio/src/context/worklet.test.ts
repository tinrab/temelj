import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { asNative, asMock } from "../../tests/audio.ts";
import {
  WorkletEffect,
  WorkletMessenger,
  AudioDisposedError,
  AudioUnsupportedError,
  createSingleIOWorkletModule,
  registerSingleIOWorklet,
} from "../mod.ts";

class MockMessagePort {
  readonly messages: Array<{ readonly message: unknown; readonly transfer?: Transferable[] }> = [];
  readonly listeners = new Set<(event: MessageEvent) => void>();
  started = false;
  closed = false;

  postMessage = vi.fn<(message: unknown, transfer?: Transferable[]) => void>(
    (message, transfer) => {
      this.messages.push({ message, transfer });
    },
  );

  start = vi.fn<() => void>(() => {
    this.started = true;
  });

  close = vi.fn<() => void>(() => {
    this.closed = true;
  });

  addEventListener = vi.fn<(type: string, listener: (event: MessageEvent) => void) => void>(
    (type, listener) => {
      if (type === "message") {
        this.listeners.add(listener);
      }
    },
  );

  removeEventListener = vi.fn<(type: string, listener: (event: MessageEvent) => void) => void>(
    (type, listener) => {
      if (type === "message") {
        this.listeners.delete(listener);
      }
    },
  );

  dispatch(data: unknown): void {
    const event = asNative<MessageEvent>({ data });

    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

class MockWorkletAudioContext {
  readonly currentTime = 0;
  readonly destination = asNative<AudioDestinationNode>({});
  readonly state: BaseAudioContext["state"] = "running";
  readonly audioWorklet = {
    addModule: vi.fn<(moduleURL: string | URL, options?: WorkletOptions) => Promise<void>>(
      async () => undefined,
    ),
  };

  createGain = vi.fn<() => GainNode>(() =>
    asNative<GainNode>({
      connect: vi.fn<(destinationNode: AudioNode | AudioParam) => AudioNode | AudioParam>(
        (destinationNode) => destinationNode,
      ),
      disconnect: vi.fn<() => void>(),
      gain: { value: 1 },
    }),
  );
}

class MockEffectAudioWorkletNode {
  readonly connect = vi.fn<(destinationNode: AudioNode | AudioParam) => AudioNode | AudioParam>(
    (destinationNode) => destinationNode,
  );
  readonly disconnect = vi.fn<() => void>();
  readonly name: string;
  readonly options: AudioWorkletNodeOptions;
  readonly port = new MockMessagePort();

  constructor(_context: BaseAudioContext, name: string, options: AudioWorkletNodeOptions = {}) {
    this.name = name;
    this.options = options;
  }
}

let revokeObjectURL = vi.fn<(url: string) => void>();

beforeEach(() => {
  vi.stubGlobal("AudioWorkletNode", class MockAudioWorkletNode {});
  revokeObjectURL = vi.fn<(url: string) => void>();
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn<(blob: Blob) => string>((blob) => `blob:${blob.type || "audio"}`),
    revokeObjectURL,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WorkletMessenger", () => {
  interface ProcessorRequest {
    readonly id: string;
    readonly type: "setGain" | "getState";
    readonly value?: number;
  }

  interface ProcessorResponse {
    readonly id: string;
    readonly type: "ready" | "state";
    readonly value?: number;
  }

  it("sends messages and dispatches typed incoming messages", () => {
    const port = new MockMessagePort();

    const messenger = new WorkletMessenger<ProcessorResponse, ProcessorRequest>(
      asNative<MessagePort>(port),
    );

    const handler = vi.fn<(message: ProcessorResponse, event: MessageEvent) => void>();
    const unsubscribe = messenger.onMessage(handler);
    const transfer: Transferable[] = [new ArrayBuffer(8)];

    messenger.send({ id: "1", type: "setGain", value: 0.5 }, transfer);
    port.dispatch({ id: "ready", type: "ready" });
    unsubscribe();
    port.dispatch({ id: "ignored", type: "ready" });

    expect(port.started).toBe(true);
    expect(port.messages).toEqual([
      { message: { id: "1", type: "setGain", value: 0.5 }, transfer },
    ]);
    expect(handler.mock.calls).toHaveLength(1);
    expect(handler.mock.calls[0]?.[0]).toEqual({ id: "ready", type: "ready" });
  });

  it("matches request responses by id", async () => {
    const port = new MockMessagePort();

    const messenger = new WorkletMessenger<
      ProcessorResponse,
      ProcessorRequest,
      ProcessorRequest,
      ProcessorResponse
    >(asNative<MessagePort>(port));

    const responsePromise = messenger.request({ id: "state-1", type: "getState" });

    expect(port.messages.at(-1)?.message).toEqual({ id: "state-1", type: "getState" });

    await expect(messenger.request({ id: "state-1", type: "getState" })).rejects.toThrow(
      "already pending",
    );

    port.dispatch({ id: "other", type: "state", value: 0 });
    port.dispatch({ id: "state-1", type: "state", value: 0.75 });

    await expect(responsePromise).resolves.toEqual({
      id: "state-1",
      type: "state",
      value: 0.75,
    });
  });

  it("rejects requests on abort, timeout, and disposal", async () => {
    const port = new MockMessagePort();

    const messenger = new WorkletMessenger<
      ProcessorResponse,
      ProcessorRequest,
      ProcessorRequest,
      ProcessorResponse
    >(asNative<MessagePort>(port));

    const controller = new AbortController();

    expect(messenger.disposed).toBe(false);

    const aborted = messenger.request(
      { id: "abort", type: "getState" },
      { signal: controller.signal },
    );

    const abortedError = aborted.catch((error) => error);
    controller.abort();

    const timedOut = messenger.request({ id: "timeout", type: "getState" }, { timeoutMs: 1 });
    await expect(timedOut).rejects.toMatchObject({ name: "TimeoutError" });

    const disposed = messenger.request({ id: "dispose", type: "getState" });
    const disposedError = disposed.catch((error) => error);
    messenger.dispose();
    messenger.dispose();

    expect(messenger.disposed).toBe(true);
    await expect(abortedError).resolves.toMatchObject({ name: "AbortError" });
    await expect(disposedError).resolves.toBeInstanceOf(AudioDisposedError);
    expect(port.removeEventListener.mock.calls.at(-1)?.[0]).toBe("message");
  });

  it("throws when sending after disposal", () => {
    const port = new MockMessagePort();
    const messenger = new WorkletMessenger(asNative<MessagePort>(port));

    messenger.dispose();

    expect(() => messenger.send({ type: "start" })).toThrow(AudioDisposedError);
  });
});

describe("single IO AudioWorklet helpers", () => {
  it("creates explicit processor module source", () => {
    const source = createSingleIOWorkletModule({
      constructorSource: "this.gain = options.processorOptions?.gain ?? 1;",
      parameterDescriptors: [
        { automationRate: "a-rate", defaultValue: 1, maxValue: 1, minValue: 0, name: "gain" },
      ],
      processSource: `
const input = inputs[0] ?? [];
const output = outputs[0] ?? [];
for (let channel = 0; channel < output.length; channel++) {
  output[channel].set(input[channel] ?? input[0] ?? new Float32Array(output[channel].length));
}
return true;`,
      processorName: "single-io-gain",
    });

    expect(source).toContain("class TemeljSingleIoGainProcessor extends AudioWorkletProcessor");
    expect(source).toContain('"name":"gain"');
    expect(source).toContain("this.gain = options.processorOptions?.gain ?? 1;");
    expect(source).toContain('registerProcessor("single-io-gain"');
    expect(source).toContain("return true;");
  });

  it("registers URL and generated source modules", async () => {
    const mock = new MockWorkletAudioContext();
    const context = asNative<BaseAudioContext>(mock);

    await expect(
      registerSingleIOWorklet(context, {
        credentials: "omit",
        moduleUrl: "/processors/pass.js",
        processorName: "pass",
      }),
    ).resolves.toBe("pass");
    await expect(
      registerSingleIOWorklet(context, {
        moduleSource: {
          processSource: "return true;",
          processorName: "generated-pass",
        },
        processorName: "generated-pass",
      }),
    ).resolves.toBe("generated-pass");

    expect(mock.audioWorklet.addModule.mock.calls[0]).toEqual([
      "/processors/pass.js",
      { credentials: "omit" },
    ]);
    expect(mock.audioWorklet.addModule.mock.calls[1]?.[0]).toBe("blob:text/javascript");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:text/javascript");
  });

  it("throws the existing unsupported AudioWorklet error", async () => {
    await expect(
      registerSingleIOWorklet(asNative<AudioContext>({ currentTime: 0 }), {
        moduleUrl: "/processor.js",
        processorName: "missing",
      }),
    ).rejects.toThrow(AudioUnsupportedError);
  });

  it("creates an effect wrapper with graph nodes, messenger, and disposal", async () => {
    vi.stubGlobal("AudioWorkletNode", MockEffectAudioWorkletNode);

    interface ProcessorRequest {
      readonly id: string;
      readonly type: "ping";
    }

    interface ProcessorResponse {
      readonly id: string;
      readonly type: "pong";
    }

    const context = asNative<BaseAudioContext>(new MockWorkletAudioContext());

    const effect = await WorkletEffect.create<
      ProcessorResponse,
      ProcessorRequest,
      ProcessorRequest,
      ProcessorResponse
    >(context, {
      moduleSource: { processSource: "return true;", processorName: "inline-pass" },
      node: {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        processorOptions: { mode: "copy" },
      },
      parameterData: { gain: 0.5 },
      processorName: "inline-pass",
    });

    const node = asMock<MockEffectAudioWorkletNode>(effect.node);

    const input = asMock<{
      readonly connect: ReturnType<
        typeof vi.fn<(destinationNode: AudioNode | AudioParam) => AudioNode>
      >;
      readonly disconnect: ReturnType<typeof vi.fn>;
    }>(effect.input);

    const output = asMock<{
      readonly connect: ReturnType<
        typeof vi.fn<(destinationNode: AudioNode | AudioParam) => AudioNode>
      >;
      readonly disconnect: ReturnType<typeof vi.fn>;
    }>(effect.output);

    const response = effect.messenger.request({ id: "1", type: "ping" });

    expect(node.name).toBe("inline-pass");
    expect(node.options.processorOptions).toEqual({ mode: "copy" });
    expect(node.options.parameterData).toEqual({ gain: 0.5 });
    expect(input.connect).toHaveBeenCalledWith(node);
    expect(node.connect).toHaveBeenCalledWith(output);
    expect(node.port.messages.at(-1)?.message).toEqual({ id: "1", type: "ping" });

    node.port.dispatch({ id: "1", type: "pong" });
    await expect(response).resolves.toEqual({ id: "1", type: "pong" });

    effect.connect(asNative<AudioNode>({}));
    expect(output.connect).toHaveBeenCalled();

    effect.dispose();
    effect.dispose();

    expect(effect.disposed).toBe(true);
    expect(input.disconnect).toHaveBeenCalledTimes(1);
    expect(node.disconnect).toHaveBeenCalledTimes(1);
    expect(output.disconnect).toHaveBeenCalledTimes(1);
    expect(effect.messenger.disposed).toBe(true);
  });
});
