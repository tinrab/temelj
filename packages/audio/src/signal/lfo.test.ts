import { beforeEach, describe, expect, it } from "vitest";

import {
  createMockAudioContext,
  MockConstantSourceNode,
  MockGainNode,
  MockOscillatorNode,
  asMock,
} from "../../tests/audio.ts";
import { BlueprintParam } from "../graph/blueprint.ts";
import {
  Lfo,
  destination as createDestination,
  lfo,
  oscillator,
  patch,
  startLfo,
  stopLfo,
} from "../mod.ts";

let destination = createDestination();

beforeEach(() => {
  destination = createDestination();
});

const context = createMockAudioContext(10);

describe("lfo", () => {
  it("creates a scaled oscillator graph", () => {
    const modulator = lfo({
      frequency: 2,
      max: 10,
      min: -10,
      type: "triangle",
    });

    expect(modulator.oscillator.options).toEqual({
      frequency: 2,
      type: "triangle",
    });
    expect(modulator.depth.options).toEqual({ gain: 10 });
    expect(modulator.offset.sources).toEqual([0]);
    expect(modulator.oscillator.connections).toContain(modulator.depth);
    expect(
      modulator.depth.connections.some(
        (connection) => "id" in connection && connection.id === modulator.id,
      ),
    ).toBe(true);
    expect(
      modulator.offset.connections.some(
        (connection) => "id" in connection && connection.id === modulator.id,
      ),
    ).toBe(true);
  });

  it("connects to AudioParam destinations through the output blueprint", () => {
    const target = oscillator();
    const modulator = lfo({ max: 400, min: 200 });

    const destinationParam = modulator.connect(target.params.frequency);

    expect(destinationParam).toBe(target.params.frequency);
    expect(modulator.connections).toContain(target.params.frequency);
    expect(destinationParam).toBeInstanceOf(BlueprintParam);
  });

  it("starts and stops the source oscillator in a patch", () => {
    const modulator = lfo({ frequency: 4, max: 1, min: 0 });
    modulator.connect(destination);

    const handle = patch(context, destination).play((playContext) => {
      startLfo(playContext, modulator, { time: "+0.5" });
      stopLfo(playContext, modulator, { time: "+1" });

      const mockSource = asMock<MockOscillatorNode>(playContext.get(modulator.oscillator));
      expect(mockSource.start.mock.calls).toContainEqual([10.5]);
      expect(mockSource.stop.mock.calls).toContainEqual([11]);
    });

    handle.dispose();
  });

  it("instantiates depth and offset nodes with the expected values", () => {
    const modulator = lfo({ frequency: 1, max: 6, min: 2 });
    modulator.connect(destination);

    patch(context, destination)
      .play((playContext) => {
        const source = asMock<MockOscillatorNode>(playContext.get(modulator.oscillator));
        const depth = asMock<MockGainNode>(playContext.get(modulator.depth));
        const offset = asMock<MockConstantSourceNode>(playContext.get(modulator.offset));

        expect(source.frequency.value).toBe(1);
        expect(depth.gain.value).toBe(2);
        expect(offset.offset.value).toBe(4);
      })
      .dispose();
  });

  it("scales an oscillator into its range and starts its sources once", () => {
    const native = createMockAudioContext(2);

    const modulator = new Lfo(native, {
      amplitude: 0.5,
      frequency: 4,
      max: 20,
      min: 10,
      type: "triangle",
    });

    const [amplitudeGain, depth] = native.createdGains;
    const center = native.createdConstantSources[0]!;

    expect(modulator.state).toBe("stopped");
    expect(modulator.oscillator.type).toBe("triangle");
    expect(modulator.frequency.value).toBe(4);
    expect(amplitudeGain!.gain.value).toBe(0.5);
    expect(depth!.gain.value).toBe(5);
    expect(center.offset.value).toBe(15);

    modulator.setRange(-10, 10, 6);
    expect(depth!.gain.setValueAtTime.mock.calls.at(-1)).toEqual([10, 6]);
    expect(center.offset.setValueAtTime.mock.calls.at(-1)).toEqual([0, 6]);

    modulator.start(7);
    modulator.start(8);
    expect(modulator.state).toBe("started");
    expect(center.start).toHaveBeenCalledExactlyOnceWith(7);

    modulator.stop(9);
    expect(modulator.state).toBe("stopped");

    modulator.dispose();
    modulator.dispose();

    for (const gain of native.createdGains) {
      expect(gain.disconnect).toHaveBeenCalledTimes(1);
    }
  });
});
