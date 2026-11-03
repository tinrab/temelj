/* oxlint-disable anti-slop/no-shape-in-symbol-names -- `WaveShaper` is the Web Audio API name (`WaveShaperNode`, `BaseAudioContext.createWaveShaper()`). */
import type {
  BiquadFilterBlueprint,
  CompressorBlueprint,
  ConvolverBlueprint,
  DelayBlueprint,
  StereoPannerBlueprint,
  WaveShaperBlueprint,
} from "../graph/blueprint.ts";

import {
  biquadFilter,
  compressor,
  convolver,
  delay,
  stereoPanner,
  waveShaper,
} from "../graph/blueprint.ts";
import {
  dubDelay,
  feedbackDelay,
  type DubDelayBlueprint,
  type DubDelayBlueprintOptions,
  type FeedbackDelayBlueprint,
  type FeedbackDelayOptions,
} from "./delay.ts";
import {
  autoFilter,
  chorus,
  flanger,
  phaser,
  vibrato,
  type AutoFilterBlueprint,
  type AutoFilterOptions,
  type ModulatedDelayBlueprint,
  type ModulatedDelayOptions,
  type PhaserBlueprint,
  type PhaserOptions,
} from "./lfo.ts";
import {
  autoPanner,
  ringModulator,
  tremolo,
  type AutoPannerBlueprint,
  type AutoPannerOptions,
  type RingModulatorBlueprint,
  type RingModulatorOptions,
  type TremoloBlueprint,
  type TremoloOptions,
} from "./modulation.ts";
import {
  quadrafuzz,
  type QuadrafuzzBlueprint,
  type QuadrafuzzBlueprintOptions,
} from "./quadrafuzz.ts";
import {
  createBitCrusherCurve,
  createChebyshevCurve,
  createDistortionCurve,
  createSoftClipCurve,
} from "./waveshaper.ts";

/**
 * Options for wave-shaper effects. `curve` overrides the generated curve.
 */
export type CurveEffectOptions<TOptions> = WaveShaperOptions &
  TOptions & {
    /**
     * Number of samples in the generated curve.
     */
    readonly samples?: number;
  };

export type EffectOptionsMap = {
  readonly autoFilter: AutoFilterOptions;
  readonly autoPanner: AutoPannerOptions;
  readonly bitCrusher: CurveEffectOptions<{ readonly bits?: number }>;
  readonly chebyshev: CurveEffectOptions<{ readonly order?: number }>;
  readonly chorus: ModulatedDelayOptions;
  readonly compressor: DynamicsCompressorOptions;
  readonly delay: DelayOptions;
  readonly distortion: CurveEffectOptions<{ readonly amount?: number }>;
  readonly dubDelay: DubDelayBlueprintOptions;
  readonly feedbackDelay: FeedbackDelayOptions;
  readonly filter: BiquadFilterOptions;
  readonly flanger: ModulatedDelayOptions;
  readonly phaser: PhaserOptions;
  readonly quadrafuzz: QuadrafuzzBlueprintOptions;
  readonly reverb: ConvolverOptions;
  readonly ringModulator: RingModulatorOptions;
  readonly softClip: CurveEffectOptions<{ readonly drive?: number }>;
  readonly stereoPanner: StereoPannerOptions;
  readonly tremolo: TremoloOptions;
  readonly vibrato: Omit<ModulatedDelayOptions, "feedback">;
};

export type EffectType = keyof EffectOptionsMap;

export type EffectBlueprintMap = {
  readonly autoFilter: AutoFilterBlueprint;
  readonly autoPanner: AutoPannerBlueprint;
  readonly bitCrusher: WaveShaperBlueprint;
  readonly chebyshev: WaveShaperBlueprint;
  readonly chorus: ModulatedDelayBlueprint;
  readonly compressor: CompressorBlueprint;
  readonly delay: DelayBlueprint;
  readonly distortion: WaveShaperBlueprint;
  readonly dubDelay: DubDelayBlueprint;
  readonly feedbackDelay: FeedbackDelayBlueprint;
  readonly filter: BiquadFilterBlueprint;
  readonly flanger: ModulatedDelayBlueprint;
  readonly phaser: PhaserBlueprint;
  readonly quadrafuzz: QuadrafuzzBlueprint;
  readonly reverb: ConvolverBlueprint;
  readonly ringModulator: RingModulatorBlueprint;
  readonly softClip: WaveShaperBlueprint;
  readonly stereoPanner: StereoPannerBlueprint;
  readonly tremolo: TremoloBlueprint;
  readonly vibrato: ModulatedDelayBlueprint;
};

type EffectFactories = {
  readonly [Type in EffectType]: (options?: EffectOptionsMap[Type]) => EffectBlueprintMap[Type];
};

function curveEffect(
  options: WaveShaperOptions,
  createCurve: () => Float32Array,
): WaveShaperBlueprint {
  return waveShaper({ ...options, curve: options.curve ?? createCurve() });
}

const EFFECT_FACTORIES: EffectFactories = {
  autoFilter,
  autoPanner,
  bitCrusher: ({ bits, samples, ...options } = {}) =>
    curveEffect(options, () => createBitCrusherCurve(bits, samples)),
  chebyshev: ({ order, samples, ...options } = {}) =>
    curveEffect(options, () => createChebyshevCurve(order, samples)),
  chorus,
  compressor,
  delay,
  distortion: ({ amount, samples, ...options } = {}) =>
    curveEffect(options, () => createDistortionCurve(amount, samples)),
  dubDelay,
  feedbackDelay,
  filter: biquadFilter,
  flanger,
  phaser,
  quadrafuzz,
  reverb: convolver,
  ringModulator,
  softClip: ({ drive, samples, ...options } = {}) =>
    curveEffect(options, () => createSoftClipCurve(drive, samples)),
  stereoPanner,
  tremolo,
  vibrato,
};

/**
 * Creates an effect blueprint by name.
 */
export function createEffect<Type extends EffectType>(
  type: Type,
  options?: EffectOptionsMap[Type],
): EffectBlueprintMap[Type] {
  const factory: EffectFactories[Type] = EFFECT_FACTORIES[type];

  return factory(options);
}
