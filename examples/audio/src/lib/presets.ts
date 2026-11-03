export type Preset = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly code: string;
};

export const PRESETS: readonly Preset[] = [
  {
    id: "echo",
    name: "Warm echo",
    description: "Soft saturation into a feedback delay and a gentle lowpass.",
    code: `import { chain, createEffect, type Blueprint } from "@temelj/audio";

// \`input\` is the microphone, the uploaded file, or the demo loop.
export default function process(input: Blueprint): Blueprint {
  const warmth = createEffect("softClip", { drive: 2 });
  const echo = createEffect("feedbackDelay", { delayTime: 0.3, feedback: 0.45 });
  const tone = createEffect("filter", { frequency: 3_500, type: "lowpass" });

  return chain(input, warmth, echo, tone);
}
`,
  },
  {
    id: "robot",
    name: "Robot voice",
    description: "Ring modulation and bit crushing. Best with the microphone.",
    code: `import { chain, createEffect, type Blueprint } from "@temelj/audio";

export default function process(input: Blueprint): Blueprint {
  // The ring modulator's carrier oscillator starts automatically with the patch.
  const ring = createEffect("ringModulator", { frequency: 55, waveform: "square" });
  const crush = createEffect("bitCrusher", { bits: 5 });
  const band = createEffect("filter", { frequency: 1_400, Q: 0.8, type: "bandpass" });

  return chain(input, band, ring, crush);
}
`,
  },
  {
    id: "space",
    name: "Chorus and phaser",
    description: "Two LFO-modulated effects in series. Their LFOs start on play.",
    code: `import { chain, chorus, phaser, type Blueprint } from "@temelj/audio";

export default function process(input: Blueprint): Blueprint {
  const wide = chorus({ delayTime: 0.006, depth: 0.7, frequency: 0.8 });
  const sweep = phaser({ baseFrequency: 300, frequency: 0.25, octaves: 4, stages: 6 });

  return chain(input, wide, sweep);
}
`,
  },
  {
    id: "radio",
    name: "Lo-fi radio",
    description: "A narrow band, light crunch, and a wobbling tremolo.",
    code: `import { chain, createEffect, tremolo, type Blueprint } from "@temelj/audio";

export default function process(input: Blueprint): Blueprint {
  const lowCut = createEffect("filter", { frequency: 500, type: "highpass" });
  const highCut = createEffect("filter", { frequency: 2_800, type: "lowpass" });
  const crunch = createEffect("distortion", { amount: 25 });
  const wobble = tremolo({ depth: 0.35, frequency: 6 });

  return chain(input, lowCut, highCut, crunch, wobble);
}
`,
  },
  {
    id: "custom",
    name: "Hand-built graph",
    description: "Raw node blueprints: a feedback loop and an LFO on a filter cutoff.",
    code: `import { biquadFilter, delay, gain, lfo, type Blueprint } from "@temelj/audio";

export default function process(input: Blueprint): Blueprint {
  // A cutoff of 0 lets the LFO below set the whole cutoff value.
  const filter = biquadFilter({ frequency: 0, Q: 6, type: "lowpass" });
  const wet = delay({ delayTime: 0.18, maxDelayTime: 1 });
  const feedback = gain({ gain: 0.55 });
  const mix = gain({ gain: 0.8 });

  // An LFO between 300 Hz and 2.4 kHz drives the filter cutoff.
  lfo({ frequency: 0.5, max: 2_400, min: 300 }).connect(filter.params.frequency);

  input.connect(filter);
  filter.connect(mix);
  filter.connect(wet);
  wet.connect(feedback).connect(wet); // feedback loop
  wet.connect(mix);

  return mix;
}
`,
  },
  {
    id: "swell",
    name: "Automated swell",
    description: "Returns a play hook that schedules automation on the live nodes.",
    code: `import {
  applyAutomation,
  chain,
  createEffect,
  gain,
  type Blueprint,
  type PlayContext,
} from "@temelj/audio";

export default function process(input: Blueprint) {
  const amp = gain({ gain: 0 });
  const space = createEffect("feedbackDelay", { delayTime: 0.45, feedback: 0.6 });

  return {
    output: chain(input, amp, space),
    // Runs when playback starts, with the native nodes of this playback.
    play({ get, time }: PlayContext) {
      applyAutomation(get(amp).gain, [
        { time: time.immediate, type: "set", value: 0 },
        { time: time.immediate + 4, type: "linearRamp", value: 1 },
      ]);
    },
  };
}
`,
  },
];

export const DEFAULT_PRESET: Preset = PRESETS[0]!;
