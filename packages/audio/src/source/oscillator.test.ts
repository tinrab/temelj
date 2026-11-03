/* oxlint-disable anti-slop/no-shape-in-symbol-names -- `WaveShaper` is the Web Audio API name (`WaveShaperNode`, `BaseAudioContext.createWaveShaper()`). */
import { describe, expect, it } from "vitest";

import {
  createMockAudioContext,
  MockConstantSourceNode,
  MockGainNode,
  MockOscillatorNode,
  MockWaveShaperNode,
  asMock,
  asNative,
  invalid,
} from "../../tests/audio.ts";
import {
  AMOscillator,
  BasicOscillator,
  UnisonOscillator,
  FMOscillator,
  OmniOscillator,
  PWMOscillator,
  PulseOscillator,
} from "../mod.ts";

describe("audio oscillator utilities", () => {
  it("creates a basic oscillator wrapper", () => {
    const context = createMockAudioContext(2);

    const basic = new BasicOscillator(context, {
      frequency: 330,
      type: "square",
    });

    const oscillator = asMock<MockOscillatorNode>(basic.oscillator);

    expect(basic.output).toBe(oscillator);
    expect(basic.disposed).toBe(false);
    expect(basic.state).toBe("stopped");
    expect(oscillator.frequency.value).toBe(330);
    expect(oscillator.type).toBe("square");

    basic.setFrequency(440, 3);
    basic.setType("triangle");
    basic.start(4);
    expect(basic.state).toBe("started");
    basic.stop(5);

    expect(oscillator.frequency.setValueAtTime).toHaveBeenCalledWith(440, 3);
    expect(oscillator.type).toBe("triangle");
    expect(oscillator.start).toHaveBeenCalledWith(4);
    expect(oscillator.stop).toHaveBeenCalledWith(5);
    expect(basic.state).toBe("stopped");

    basic.dispose();
    basic.dispose();
    expect(basic.disposed).toBe(true);
    expect(oscillator.disconnect).toHaveBeenCalledTimes(1);
  });

  it("creates a pulse oscillator with a waveshaped source", () => {
    const context = createMockAudioContext(2);

    const pulse = new PulseOscillator(context, {
      frequency: 220,
      type: "triangle",
      width: 0.25,
    });

    const oscillator = asMock<MockOscillatorNode>(pulse.oscillator);
    const curveNode = asMock<MockWaveShaperNode>(pulse.curveNode);

    expect(oscillator.frequency.value).toBe(220);
    expect(pulse.disposed).toBe(false);
    expect(pulse.state).toBe("stopped");
    expect(oscillator.type).toBe("triangle");
    expect(curveNode.curve).toBeInstanceOf(Float32Array);
    expect(oscillator.connect).toHaveBeenCalledWith(curveNode);

    // The input ramps evenly over the curve, so the share of high points is the duty cycle.
    const highShare = (curve: Float32Array | null): number =>
      curve === null ? 0 : curve.filter((value) => value > 0).length / curve.length;

    expect(highShare(curveNode.curve)).toBeCloseTo(0.25, 2);

    pulse.setWidth(0.75);
    expect(highShare(curveNode.curve)).toBeCloseTo(0.75, 2);
    pulse.setType("sawtooth");
    pulse.setFrequency(330, 3);
    pulse.start(4);
    expect(pulse.state).toBe("started");
    pulse.stop(5);

    expect(pulse.width).toBe(0.75);
    expect(pulse.type).toBe("sawtooth");
    expect(oscillator.frequency.setValueAtTime).toHaveBeenCalledWith(330, 3);
    expect(oscillator.start).toHaveBeenCalledWith(4);
    expect(oscillator.stop).toHaveBeenCalledWith(5);
    expect(pulse.state).toBe("stopped");

    pulse.dispose();
    pulse.dispose();
    expect(pulse.disposed).toBe(true);
    expect(oscillator.disconnect).toHaveBeenCalledTimes(1);
    expect(curveNode.disconnect).toHaveBeenCalledTimes(1);
  });

  it("creates a PWM oscillator with width modulation", () => {
    const context = createMockAudioContext(2);

    const pwm = new PWMOscillator(context, {
      frequency: 120,
      modulationDepth: 0.25,
      modulationFrequency: 0.75,
    });

    const carrier = asMock<MockOscillatorNode>(pwm.carrier);
    const modulator = asMock<MockOscillatorNode>(pwm.modulator);
    const modulationGain = context.createdGains[0]!;
    const curveNode = asMock<MockWaveShaperNode>(pwm.curveNode);

    expect(pwm.disposed).toBe(false);
    expect(pwm.state).toBe("stopped");
    expect(carrier.frequency.value).toBe(120);
    expect(carrier.type).toBe("triangle");
    expect(modulator.frequency.value).toBe(0.75);
    expect(modulator.type).toBe("sine");
    expect(modulationGain.gain.value).toBe(0.25);
    expect(curveNode.curve?.[0]).toBe(-1);
    expect(curveNode.curve?.at(-1)).toBe(1);
    expect(carrier.connect).toHaveBeenCalledWith(curveNode);
    expect(modulator.connect).toHaveBeenCalledWith(modulationGain);
    expect(modulationGain.connect).toHaveBeenCalledWith(curveNode);

    pwm.setFrequency(240, 3);
    pwm.setModulationFrequency(1.5, 4);
    pwm.setModulationDepth(2, 5);
    pwm.start(6);
    expect(pwm.state).toBe("started");
    pwm.stop(7);

    expect(carrier.frequency.setValueAtTime).toHaveBeenCalledWith(240, 3);
    expect(modulator.frequency.setValueAtTime).toHaveBeenCalledWith(1.5, 4);
    expect(modulationGain.gain.setValueAtTime).toHaveBeenCalledWith(1, 5);
    expect(carrier.start).toHaveBeenCalledWith(6);
    expect(modulator.start).toHaveBeenCalledWith(6);
    expect(carrier.stop).toHaveBeenCalledWith(7);
    expect(modulator.stop).toHaveBeenCalledWith(7);
    expect(pwm.state).toBe("stopped");

    pwm.dispose();
    pwm.dispose();
    expect(pwm.disposed).toBe(true);
    expect(carrier.disconnect).toHaveBeenCalledTimes(1);
    expect(modulator.disconnect).toHaveBeenCalledTimes(1);
    expect(modulationGain.disconnect).toHaveBeenCalledTimes(1);
    expect(curveNode.disconnect).toHaveBeenCalledTimes(1);
  });

  it("creates an FM oscillator with carrier and modulator controls", () => {
    const context = createMockAudioContext(2);

    const fm = new FMOscillator(context, {
      frequency: 200,
      harmonicity: 0.5,
      modulationIndex: 3,
      modulationType: "triangle",
      type: "square",
    });

    const source = asMock<MockConstantSourceNode>(fm.frequency);
    const carrier = asMock<MockOscillatorNode>(fm.carrier);
    const modulator = asMock<MockOscillatorNode>(fm.modulator);
    const modulationGain = asMock<MockGainNode>(fm.modulationGain);

    expect(source.offset.value).toBe(200);
    expect(fm.disposed).toBe(false);
    expect(fm.state).toBe("stopped");
    expect(carrier.frequency.value).toBe(0);
    expect(carrier.type).toBe("square");
    expect(modulator.frequency.value).toBe(100);
    expect(modulator.type).toBe("triangle");
    expect(modulationGain.gain.value).toBe(600);
    expect(source.connect).toHaveBeenCalledWith(carrier.frequency);
    expect(modulator.connect).toHaveBeenCalledWith(modulationGain);
    expect(modulationGain.connect).toHaveBeenCalledWith(carrier.frequency);

    fm.setFrequency(300, 4);
    fm.setHarmonicity(2, 5);
    fm.setModulationIndex(4, 6);
    fm.setType("sawtooth");
    fm.setModulationType("sine");
    fm.start(7);
    expect(fm.state).toBe("started");
    fm.stop(8);

    expect(source.offset.setValueAtTime).toHaveBeenCalledWith(300, 4);
    expect(modulator.frequency.setValueAtTime).toHaveBeenCalledWith(600, 5);
    expect(modulationGain.gain.setValueAtTime).toHaveBeenCalledWith(1200, 6);
    expect(fm.type).toBe("sawtooth");
    expect(fm.modulationType).toBe("sine");
    expect(source.start).toHaveBeenCalledWith(7);
    expect(modulator.start).toHaveBeenCalledWith(7);
    expect(carrier.start).toHaveBeenCalledWith(7);
    expect(source.stop).toHaveBeenCalledWith(8);
    expect(fm.state).toBe("stopped");

    fm.dispose();
    fm.dispose();
    expect(fm.disposed).toBe(true);
    expect(source.disconnect).toHaveBeenCalledTimes(1);
    expect(modulator.disconnect).toHaveBeenCalledTimes(1);
    expect(modulationGain.disconnect).toHaveBeenCalledTimes(1);
    expect(carrier.disconnect).toHaveBeenCalledTimes(1);
  });

  it("creates an AM oscillator with audio-to-gain modulation", () => {
    const context = createMockAudioContext(2);

    const am = new AMOscillator(context, {
      frequency: 110,
      harmonicity: 2,
      modulationType: "sawtooth",
      type: "triangle",
    });

    const carrier = asMock<MockOscillatorNode>(am.carrier);
    const modulator = asMock<MockOscillatorNode>(am.modulator);
    const scale = asMock<MockWaveShaperNode>(am.modulationScale);
    const gain = asMock<MockGainNode>(am.modulationGain);

    expect(carrier.frequency.value).toBe(110);
    expect(am.disposed).toBe(false);
    expect(am.state).toBe("stopped");
    expect(carrier.type).toBe("triangle");
    expect(modulator.frequency.value).toBe(220);
    expect(modulator.type).toBe("sawtooth");
    expect(scale.curve?.[0]).toBe(0);
    expect(scale.curve?.at(-1)).toBe(1);
    expect(modulator.connect).toHaveBeenCalledWith(scale);
    expect(scale.connect).toHaveBeenCalledWith(gain.gain);
    expect(carrier.connect).toHaveBeenCalledWith(gain);

    am.setFrequency(220, 3);
    am.setHarmonicity(3, 4);
    am.setType("square");
    am.setModulationType("sine");

    expect(carrier.frequency.setValueAtTime).toHaveBeenCalledWith(220, 3);
    expect(modulator.frequency.setValueAtTime).toHaveBeenCalledWith(660, 4);
    expect(am.type).toBe("square");
    expect(am.modulationType).toBe("sine");

    am.start(5);
    expect(am.state).toBe("started");
    am.stop(6);
    expect(am.state).toBe("stopped");

    am.dispose();
    am.dispose();
    expect(am.disposed).toBe(true);
    expect(modulator.disconnect).toHaveBeenCalledTimes(1);
    expect(scale.disconnect).toHaveBeenCalledTimes(1);
    expect(carrier.disconnect).toHaveBeenCalledTimes(1);
    expect(gain.disconnect).toHaveBeenCalledTimes(1);
  });

  it("creates a fat oscillator with spread detuning", () => {
    const context = createMockAudioContext(2);

    const fat = new UnisonOscillator(context, {
      count: 3,
      detune: 5,
      frequency: 55,
      spread: 20,
      type: "sawtooth",
    });

    const oscillators = asMock<MockOscillatorNode[]>(fat.oscillators);
    const volume = asMock<MockGainNode>(fat.volume);

    expect(oscillators).toHaveLength(3);
    expect(fat.disposed).toBe(false);
    expect(fat.state).toBe("stopped");
    expect(oscillators.map((oscillator) => oscillator.detune.value)).toEqual([-5, 5, 15]);
    expect(oscillators.every((oscillator) => oscillator.frequency.value === 55)).toBe(true);
    expect(volume.gain.value).toBe(1 / 3);
    expect(
      oscillators.every(
        (oscillator) => oscillator.connect.mock.calls[0]?.[0] === asNative<AudioNode>(volume),
      ),
    ).toBe(true);

    fat.setFrequency(110, 3);
    fat.setSpread(40, 4);
    fat.setDetune(-10, 5);
    fat.setType("square");
    fat.start(6);
    expect(fat.state).toBe("started");
    fat.stop(7);

    expect(
      oscillators.every((oscillator) =>
        oscillator.frequency.setValueAtTime.mock.calls.some(
          (call) => call[0] === 110 && call[1] === 3,
        ),
      ),
    ).toBe(true);
    expect(oscillators.map((oscillator) => oscillator.detune.value)).toEqual([-30, -10, 10]);
    expect(oscillators.every((oscillator) => oscillator.type === "square")).toBe(true);
    expect(oscillators.every((oscillator) => oscillator.start.mock.calls[0]?.[0] === 6)).toBe(true);
    expect(oscillators.every((oscillator) => oscillator.stop.mock.calls[0]?.[0] === 7)).toBe(true);
    expect(fat.state).toBe("stopped");

    fat.dispose();
    fat.dispose();
    expect(fat.disposed).toBe(true);
    expect(oscillators.every((oscillator) => oscillator.disconnect.mock.calls.length === 1)).toBe(
      true,
    );
    expect(volume.disconnect).toHaveBeenCalledTimes(1);
  });

  it("creates and switches an omni oscillator source", () => {
    const context = createMockAudioContext(2);

    const omni = new OmniOscillator(context, {
      frequency: 220,
      modulationFrequency: 0.25,
      type: "unisonsquare",
    });

    const initial = omni.oscillator;
    const output = asMock<MockGainNode>(omni.output);

    expect(omni.type).toBe("unisonsquare");
    expect(omni.disposed).toBe(false);
    expect(omni.state === "started").toBe(false);
    expect(omni.state).toBe("stopped");
    expect(context.createdOscillators).toHaveLength(3);
    expect(asMock<MockGainNode>(initial.output).connect).toHaveBeenCalledWith(output);

    omni.start(3);
    expect(omni.state === "started").toBe(true);
    expect(omni.state).toBe("started");
    omni.setFrequency(330, 4);
    omni.setType("pwm");

    const switched = omni.oscillator;
    expect(omni.type).toBe("pwm");
    expect(switched).not.toBe(initial);
    expect(asMock<MockWaveShaperNode>(switched.output).connect).toHaveBeenCalledWith(output);
    expect(context.createdOscillators.at(-2)?.start).toHaveBeenCalledWith(2);
    expect(context.createdOscillators.at(-1)?.start).toHaveBeenCalledWith(2);

    omni.stop(5);
    expect(omni.state === "started").toBe(false);
    expect(omni.state).toBe("stopped");
    omni.dispose();
    omni.dispose();

    expect(omni.disposed).toBe(true);
    expect(output.disconnect).toHaveBeenCalledTimes(1);
    expect(
      () =>
        new OmniOscillator(context, {
          type: invalid<"fm">("fmcustom"),
        }),
    ).toThrow(RangeError);
  });
});
