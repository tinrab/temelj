import { describe, expect, it } from "vitest";

import {
  asNative,
  createMockAudioBuffer,
  createMockAudioContext,
  createMockFacade,
  type MockBufferSourceNode,
  type MockOscillatorNode,
  asMock,
  MockAudioNode,
} from "../../tests/audio.ts";
import { AudioDisposedError, AudioGraphError } from "../errors.ts";
import { signal } from "../signal/signal.ts";
import {
  biquadFilter,
  bufferSource,
  chain,
  channelSplitter,
  destination,
  gain,
  oscillator,
  player,
} from "./blueprint.ts";
import { collectUpstream, patch, playPlayer } from "./patch.ts";

describe("collectUpstream", () => {
  it("returns sources first and ignores nodes that do not reach the output", () => {
    const source = oscillator();
    const amp = gain();
    const output = destination();
    const unrelated = oscillator();
    chain(source, amp, output);
    unrelated.connect(gain());

    expect(collectUpstream(output)).toEqual([source, amp, output]);
  });

  it("includes nodes that only modulate params", () => {
    const filter = biquadFilter();
    const modulator = oscillator();
    const output = destination();
    filter.connect(output);
    modulator.connect(filter.params.frequency);

    expect(collectUpstream(output)).toEqual([modulator, filter, output]);
  });
});

describe("patch", () => {
  it("materializes and wires the graph upstream of the destination", () => {
    const context = createMockAudioContext();
    const source = oscillator({ frequency: 220 });
    const amp = gain({ gain: 0.5 });
    const output = destination();
    chain(source, amp, output);

    patch(context, output).play(({ get, start }) => {
      start(source, { time: 2 });

      const native = asNative<MockOscillatorNode>(get(source));
      expect(native.frequency.value).toBe(220);
      expect(native.connect).toHaveBeenCalledWith(get(amp), 0, 0);
      expect(native.start).toHaveBeenCalledWith(2);
      expect(context.createdGains[0]?.gain.value).toBe(0.5);
    });
  });

  it("connects param modulation and channel indices", () => {
    const context = createMockAudioContext();
    const splitter = channelSplitter({ numberOfOutputs: 2 });
    const filter = biquadFilter();
    const output = destination();
    splitter.connect(filter, 1, 0);
    filter.connect(output);
    const modulator = oscillator();
    modulator.connect(filter.params.frequency);

    patch(context, output).play(({ get }) => {
      expect(asMock<MockAudioNode>(get(splitter)).connect).toHaveBeenCalledWith(get(filter), 1, 0);
      expect(asMock<MockAudioNode>(get(modulator)).connect).toHaveBeenCalledWith(
        get(filter).frequency,
        0,
      );
    });
  });

  it("starts constant signals automatically and stops them with the playback", () => {
    const context = createMockAudioContext();
    const offset = signal(0.25);
    const output = destination();
    offset.connect(output);

    const handle = patch(context, output).play();
    const constant = context.createdConstantSources[0];

    expect(constant?.start).toHaveBeenCalledOnce();
    handle.stop(5);
    expect(constant?.stop).toHaveBeenCalledWith(5);
  });

  it("throws for blueprints outside the playback", () => {
    const context = createMockAudioContext();
    const output = destination();

    patch(context, output).play(({ get }) => {
      expect(() => get(oscillator())).toThrow(AudioGraphError);
    });
  });

  it("uses the facade look-ahead as the default start time", () => {
    const context = createMockAudioContext(3);
    const source = oscillator();
    const output = destination();
    source.connect(output);

    patch(createMockFacade(context, 0.5), output).play(({ get, start, time }) => {
      start(source);
      expect(asNative<MockOscillatorNode>(get(source)).start).toHaveBeenCalledWith(3.5);
      expect(time.now).toBe(3.5);
      expect(time.immediate).toBe(3);
    });
  });
});

describe("playback", () => {
  function createBufferPlayback() {
    const context = createMockAudioContext(0);
    const source = bufferSource({ buffer: createMockAudioBuffer(10) });
    const output = destination();
    source.connect(output);

    const handle = patch(context, output).play(({ start }) => {
      start(source, { offset: 1 });
    });

    return { context, handle };
  }

  it("tracks the playback position while running and paused", () => {
    const { context, handle } = createBufferPlayback();

    context.currentTime = 2;
    expect(handle.currentTime).toBe(2);

    handle.pause();
    context.currentTime = 5;
    expect(handle.currentTime).toBe(2);
    expect(context.createdSources[0]?.stop).toHaveBeenCalledWith(2);
  });

  it("resumes with a fresh source at the paused offset", () => {
    const { context, handle } = createBufferPlayback();
    context.currentTime = 2;
    handle.pause();

    context.currentTime = 4;
    handle.resume();

    const resumed = context.createdSources[1];
    expect(resumed?.start).toHaveBeenCalledWith(4, 3);
    context.currentTime = 5;
    expect(handle.currentTime).toBe(3);
  });

  it("seeks by restarting sources at the new position", () => {
    const { context, handle } = createBufferPlayback();
    context.currentTime = 1;

    handle.seek(6);

    expect(context.createdSources[1]?.start).toHaveBeenCalledWith(1, 7);
    expect(handle.currentTime).toBe(6);
  });

  it("resolves finished when every started source ends", async () => {
    const { context, handle } = createBufferPlayback();
    const source: MockBufferSourceNode | undefined = context.createdSources[0];

    source?.dispatchEnded();

    await expect(handle.finished).resolves.toBeUndefined();
  });

  it("refreshes wiring when the blueprint graph changes", () => {
    const context = createMockAudioContext();
    const source = oscillator();
    const output = destination();
    source.connect(output);
    const handle = patch(context, output).play();

    const amp = gain();
    source.disconnect(output);
    chain(source, amp, output);
    handle.refresh();

    expect(context.createdGains).toHaveLength(1);
    expect(context.createdOscillators[0]?.connect).toHaveBeenLastCalledWith(
      context.createdGains[0],
      0,
      0,
    );
    expect(context.createdOscillators[0]?.disconnect).toHaveBeenCalledExactlyOnceWith(
      context.destination,
      0,
      0,
    );
  });

  it("leaves unchanged connections alone on refresh", () => {
    const context = createMockAudioContext();
    const source = oscillator();
    const amp = gain();
    const output = destination();
    chain(source, amp, output);
    const handle = patch(context, output).play();

    gain().connect(amp);
    handle.refresh();
    handle.refresh();

    const [ampNode, extraNode] = context.createdGains;
    expect(context.createdOscillators[0]?.connect).toHaveBeenCalledOnce();
    expect(context.createdOscillators[0]?.disconnect).not.toHaveBeenCalled();
    expect(ampNode?.connect).toHaveBeenCalledOnce();
    expect(extraNode?.connect).toHaveBeenCalledExactlyOnceWith(ampNode, 0, 0);
  });

  it("reconnects param modulation of a source restarted by seek", () => {
    const context = createMockAudioContext();
    const carrier = oscillator();
    const output = destination();
    carrier.connect(output);
    signal(5).connect(carrier.params.frequency);

    const handle = patch(context, output).play(({ start }) => {
      start(carrier);
    });

    handle.seek(1);

    const [, restarted] = context.createdOscillators;
    const modulator = context.createdConstantSources[0];
    expect(restarted).toBeDefined();
    expect(modulator?.connect).toHaveBeenLastCalledWith(restarted?.frequency, 0);
  });

  it("rejects use after dispose", () => {
    const context = createMockAudioContext();
    const output = destination();
    const graph = patch(context, output);
    const handle = graph.play();

    graph.dispose();

    expect(handle.disposed).toBe(true);
    expect(() => handle.resume()).toThrow(AudioDisposedError);
    expect(() => graph.play()).toThrow(AudioDisposedError);
  });
});

describe("playPlayer", () => {
  it("plays a player on its own destination", () => {
    const context = createMockAudioContext(0);
    const track = player({ buffer: createMockAudioBuffer(), volume: 0.5 });

    playPlayer(context, track, { offset: 0.25, duration: 0.5, time: 1 });

    expect(context.createdSources[0]?.start).toHaveBeenCalledWith(1, 0.25, 0.5);
    expect(context.createdGains[0]?.gain.value).toBe(0.5);
  });
});
