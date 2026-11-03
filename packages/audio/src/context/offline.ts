import type { DestinationBlueprint } from "../graph/blueprint.ts";
import type { PlayContext } from "../graph/patch.ts";
import type { OfflineAudioContextFacade } from "./facade.ts";

import { patch } from "../graph/patch.ts";
import { requirePositive, requirePositiveInteger, snapToFrame } from "../validation.ts";
import { createOfflineAudioContext } from "./context.ts";

export type OfflineRenderOptions = {
  /**
   * Output of the graph to render.
   */
  readonly destination: DestinationBlueprint;
  /**
   * Rendered length in seconds.
   */
  readonly duration: number;
  /**
   * Channels in the rendered buffer. Defaults to 2.
   */
  readonly numberOfChannels?: number;
  /**
   * Sample rate of the rendered buffer. Defaults to 44,100.
   */
  readonly sampleRate?: number;
};

export type OfflineRenderCallback = (
  context: PlayContext,
  offlineContext: OfflineAudioContextFacade,
) => Promise<void> | void;

const DEFAULT_SAMPLE_RATE = 44_100;

const DEFAULT_CHANNEL_COUNT = 2;

/**
 * Renders the graph upstream of `options.destination` into an `AudioBuffer`. `setup` starts
 * sources and schedules automation before rendering begins.
 */
export async function renderOffline(
  options: OfflineRenderOptions,
  setup: OfflineRenderCallback,
): Promise<AudioBuffer> {
  const sampleRate = requirePositive(options.sampleRate ?? DEFAULT_SAMPLE_RATE, "sampleRate");

  const offlineContext = createOfflineAudioContext({
    length: Math.ceil(snapToFrame(requirePositive(options.duration, "duration") * sampleRate)),
    numberOfChannels: requirePositiveInteger(
      options.numberOfChannels ?? DEFAULT_CHANNEL_COUNT,
      "numberOfChannels",
    ),
    sampleRate,
  });

  const offlinePatch = patch(offlineContext, options.destination);

  try {
    const pendingSetups: Promise<void>[] = [];
    offlinePatch.play((playContext) => {
      pendingSetups.push(Promise.resolve(setup(playContext, offlineContext)));
    });
    await Promise.all(pendingSetups);

    return await offlineContext.render();
  } finally {
    offlinePatch.dispose();
  }
}
