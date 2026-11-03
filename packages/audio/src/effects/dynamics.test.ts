import { describe, expect, it } from "vitest";

import {
  createMockAudioContext,
  MockAnalyserNode,
  MockChannelMergerNode,
  MockChannelSplitterNode,
  MockDynamicsCompressorNode,
  MockGainNode,
  asNative,
  createMockFacade,
  asMock,
} from "../../tests/audio.ts";
import { Compressor, Gate, Limiter, MidSideCompressor } from "../mod.ts";

describe("dynamics utilities", () => {
  it("creates a compressor with native DynamicsCompressorNode params", () => {
    const context = createMockAudioContext(2);

    const compressor = new Compressor(context, {
      attack: 0.01,
      knee: 12,
      ratio: 4,
      release: 0.2,
      threshold: -18,
    });

    const node = asMock<MockDynamicsCompressorNode>(compressor.compressor);

    expect(compressor.input).toBe(compressor.output);
    expect(compressor.disposed).toBe(false);
    expect(compressor.threshold).toBe(asNative<AudioParam>(node.threshold));
    expect(compressor.reduction).toBe(-3);
    expect(node.threshold.setValueAtTime.mock.calls.at(-1)).toEqual([-18, 2]);
    expect(node.ratio.setValueAtTime.mock.calls.at(-1)).toEqual([4, 2]);
    expect(node.attack.setValueAtTime.mock.calls.at(-1)).toEqual([0.01, 2]);
  });

  it("updates compressor params at explicit or facade immediate times", () => {
    const native = createMockAudioContext(3);
    const facade = createMockFacade(asNative<AudioContext>(native), 0.5);
    const compressor = new Compressor(facade);
    const node = asMock<MockDynamicsCompressorNode>(compressor.compressor);

    compressor.setThreshold(-9);
    compressor.setKnee(6, 4);
    compressor.setRatio(8, 5);
    compressor.setAttack(0.02, 6);
    compressor.setRelease(0.3, 7);

    expect(node.threshold.setValueAtTime.mock.calls.at(-1)).toEqual([-9, 3]);
    expect(node.knee.setValueAtTime.mock.calls.at(-1)).toEqual([6, 4]);
    expect(node.ratio.setValueAtTime.mock.calls.at(-1)).toEqual([8, 5]);
    expect(node.attack.setValueAtTime.mock.calls.at(-1)).toEqual([0.02, 6]);
    expect(node.release.setValueAtTime.mock.calls.at(-1)).toEqual([0.3, 7]);
  });

  it("creates a limiter with fast max-ratio compressor settings", () => {
    const context = createMockAudioContext(1);

    const limiter = new Limiter(context, { threshold: -6 });
    const node = asMock<MockDynamicsCompressorNode>(limiter.compressor);

    expect(node.threshold.value).toBe(-6);
    expect(node.ratio.value).toBe(20);
    expect(node.attack.value).toBe(0.003);
    expect(node.release.value).toBe(0.01);
    expect(node.knee.value).toBe(0);

    limiter.dispose();
    limiter.dispose();
    expect(limiter.disposed).toBe(true);
    expect(node.disconnect).toHaveBeenCalledTimes(1);
  });

  it("creates a mid-side compressor with independently configured branches", () => {
    const context = createMockAudioContext(2);

    const compressor = new MidSideCompressor(context, {
      mid: { ratio: 4, threshold: -18 },
      side: { release: 0.4, threshold: -32 },
    });

    const midNode = asMock<MockDynamicsCompressorNode>(compressor.mid.compressor);
    const sideNode = asMock<MockDynamicsCompressorNode>(compressor.side.compressor);
    const splitMid = asMock<MockGainNode>(compressor.midSideSplit.mid);
    const splitSide = asMock<MockGainNode>(compressor.midSideSplit.side);
    const mergeMid = asMock<MockGainNode>(compressor.midSideMerge.mid);
    const mergeSide = asMock<MockGainNode>(compressor.midSideMerge.side);

    expect(compressor.input).toBe(compressor.midSideSplit.input);
    expect(compressor.disposed).toBe(false);
    expect(compressor.output).toBe(compressor.midSideMerge.output);
    expect(splitMid.connect).toHaveBeenCalledWith(midNode);
    expect(midNode.connect).toHaveBeenCalledWith(mergeMid);
    expect(splitSide.connect).toHaveBeenCalledWith(sideNode);
    expect(sideNode.connect).toHaveBeenCalledWith(mergeSide);
    expect(midNode.threshold.value).toBe(-18);
    expect(midNode.ratio.value).toBe(4);
    expect(midNode.release.value).toBe(0.03);
    expect(sideNode.threshold.value).toBe(-32);
    expect(sideNode.ratio.value).toBe(6);
    expect(sideNode.release.value).toBe(0.4);

    compressor.dispose();
    compressor.dispose();

    expect(compressor.disposed).toBe(true);
    expect(compressor.mid.disposed).toBe(true);
    expect(compressor.side.disposed).toBe(true);
    expect(midNode.disconnect).toHaveBeenCalledTimes(1);
    expect(sideNode.disconnect).toHaveBeenCalledTimes(1);
    expect(
      asMock<MockChannelSplitterNode>(compressor.midSideSplit.input).disconnect,
    ).toHaveBeenCalledTimes(1);
    expect(
      asMock<MockChannelMergerNode>(compressor.midSideMerge.output).disconnect,
    ).toHaveBeenCalledTimes(1);
  });

  it("creates an analyser-driven gate and opens or closes from RMS level", () => {
    const context = createMockAudioContext(2);

    const gate = new Gate(context, { attack: 0.01, release: 0.2, threshold: -12 });
    const input = asMock<MockGainNode>(gate.input);
    const gateNode = asMock<MockGainNode>(gate.gate);
    const analyser = asMock<MockAnalyserNode>(gate.analyser);

    expect(input.connect.mock.calls).toEqual([[gateNode], [analyser]]);
    expect(gate.output).toBe(gate.gate);
    expect(gate.disposed).toBe(false);
    expect(gate.open).toBe(false);
    expect(gateNode.gain.value).toBe(0);

    analyser.samples = [0.5, -0.5, 0.5, -0.5];
    expect(gate.update(3)).toBe(true);
    expect(gate.open).toBe(true);
    expect(gateNode.gain.setTargetAtTime.mock.calls.at(-1)).toEqual([1, 3, 0.01]);

    analyser.samples = [0.01, -0.01, 0.01, -0.01];
    expect(gate.update(4)).toBe(false);
    expect(gate.open).toBe(false);
    expect(gateNode.gain.setTargetAtTime.mock.calls.at(-1)).toEqual([0, 4, 0.2]);
  });

  it("uses peak detection, threshold updates, facade time, and disposes gate nodes", () => {
    const native = createMockAudioContext(5);
    const facade = createMockFacade(asNative<AudioContext>(native), 0.5);
    const gate = new Gate(facade, { threshold: -6, usePeak: true });
    const input = asMock<MockGainNode>(gate.input);
    const gateNode = asMock<MockGainNode>(gate.gate);
    const analyser = asMock<MockAnalyserNode>(gate.analyser);

    analyser.samples = [0, 0.4, 0, 0];
    expect(gate.update()).toBe(false);
    expect(gate.open).toBe(false);

    gate.setThreshold(-12);
    expect(gate.threshold).toBe(-12);
    expect(gate.update()).toBe(true);
    expect(gateNode.gain.setTargetAtTime.mock.calls.at(-1)?.[1]).toBe(5);

    gate.dispose();
    gate.dispose();

    expect(gate.disposed).toBe(true);
    expect(input.disconnect).toHaveBeenCalledTimes(1);
    expect(gateNode.disconnect).toHaveBeenCalledTimes(1);
    expect(analyser.disconnect).toHaveBeenCalledTimes(1);
  });
});
