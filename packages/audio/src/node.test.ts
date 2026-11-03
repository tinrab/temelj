import { describe, expect, it } from "vitest";

import { MockAudioParam, MockDelayNode, MockGainNode, asNative, asMock } from "../tests/audio.ts";
import {
  AudioGraphError,
  chainAudio,
  connectAudio,
  disconnectAudio,
  fanAudio,
  getAudioChannelProperties,
  getAudioInputCount,
  getAudioOutputCount,
  setAudioChannelProperties,
} from "./mod.ts";

describe("audio routing helpers", () => {
  it("connects native nodes and returns the target", () => {
    const source = asNative<GainNode>(new MockGainNode());
    const target = asNative<DelayNode>(new MockDelayNode());

    const result = connectAudio(source, target, 1, 2);

    expect(result).toBe(target);
    expect(asMock<MockGainNode>(source).connect).toHaveBeenCalledWith(target, 1, 2);
  });

  it("connects structural audio handles through output and input", () => {
    const sourceNode = new MockGainNode();
    const targetNode = new MockDelayNode();
    const source = { output: asNative<GainNode>(sourceNode) };
    const target = { input: asNative<DelayNode>(targetNode) };

    const result = connectAudio(source, target);

    expect(result).toBe(target);
    expect(sourceNode.connect).toHaveBeenCalledWith(targetNode, 0, 0);
  });

  it("connects to AudioParam-like targets without an input index", () => {
    const source = asNative<GainNode>(new MockGainNode());
    const target = asNative<AudioParam>(new MockAudioParam(0));

    connectAudio(source, target, 1, 2);

    expect(asMock<MockGainNode>(source).connect).toHaveBeenCalledWith(target, 1);
  });

  it("disconnects all routing or a specific target", () => {
    const source = asNative<GainNode>(new MockGainNode());
    const target = asNative<DelayNode>(new MockDelayNode());
    const param = asNative<AudioParam>(new MockAudioParam(0));

    disconnectAudio(source);
    disconnectAudio(source, target, 1, 2);
    disconnectAudio(source, param, 3, 4);

    const disconnect = asMock<MockGainNode>(source).disconnect;
    expect(disconnect.mock.calls[0]).toEqual([]);
    expect(disconnect.mock.calls[1]).toEqual([target, 1, 2]);
    expect(disconnect.mock.calls[2]).toEqual([param, 3]);
  });

  it("chains and fans structural audio routes", () => {
    const sourceNode = new MockGainNode();
    const middleNode = new MockDelayNode();
    const targetNode = new MockGainNode();
    const extraNode = new MockGainNode();
    const source = { output: asNative<GainNode>(sourceNode) };

    const middle = {
      input: asNative<DelayNode>(middleNode),
      output: asNative<DelayNode>(middleNode),
    };

    const target = { input: asNative<GainNode>(targetNode) };
    const extra = { input: asNative<GainNode>(extraNode) };

    expect(chainAudio(source, middle, target)).toBe(source);
    expect(fanAudio(source, target, extra)).toBe(source);

    expect(sourceNode.connect).toHaveBeenCalledWith(middleNode, 0, 0);
    expect(middleNode.connect).toHaveBeenCalledWith(targetNode, 0, 0);
    expect(sourceNode.connect).toHaveBeenCalledWith(targetNode, 0, 0);
    expect(sourceNode.connect).toHaveBeenCalledWith(extraNode, 0, 0);
  });

  it("rejects invalid chain input", () => {
    const source = asNative<GainNode>(new MockGainNode());

    expect(() => chainAudio(source)).toThrow(AudioGraphError);
  });

  it("inspects input and output counts on native nodes and structural handles", () => {
    const sourceNode = new MockGainNode();
    const targetNode = new MockDelayNode();
    sourceNode.numberOfOutputs = 2;
    targetNode.numberOfInputs = 3;
    const source = { output: asNative<GainNode>(sourceNode) };
    const target = { input: asNative<DelayNode>(targetNode) };

    expect(getAudioOutputCount(source)).toBe(2);
    expect(getAudioInputCount(target)).toBe(3);
    expect(getAudioInputCount(asNative<AudioParam>(new MockAudioParam(0)))).toBe(1);
  });

  it("reads and writes channel properties across structural input and output nodes", () => {
    const input = new MockGainNode();
    const output = new MockDelayNode();

    const route = {
      input: asNative<GainNode>(input),
      output: asNative<DelayNode>(output),
    };

    expect(getAudioChannelProperties(route)).toEqual({
      channelCount: 2,
      channelCountMode: "max",
      channelInterpretation: "speakers",
    });

    setAudioChannelProperties(route, {
      channelCount: 1,
      channelCountMode: "explicit",
      channelInterpretation: "discrete",
    });

    expect(input.channelCount).toBe(1);
    expect(output.channelCount).toBe(1);
    expect(input.channelCountMode).toBe("explicit");
    expect(output.channelCountMode).toBe("explicit");
    expect(input.channelInterpretation).toBe("discrete");
    expect(output.channelInterpretation).toBe("discrete");
  });

  it("rejects channel property access for routes without AudioNodes", () => {
    const route = { input: asNative<AudioParam>(new MockAudioParam(0)) };

    expect(() => getAudioChannelProperties(route)).toThrow(AudioGraphError);
    expect(() => setAudioChannelProperties(route, { channelCount: 1 })).toThrow(AudioGraphError);
  });
});
