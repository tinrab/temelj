import { isNumber } from "@temelj/value";

import { AudioGraphError } from "./errors.ts";

export type AudioInputTarget =
  | AudioNode
  | AudioParam
  | {
      readonly input: AudioNode | AudioParam;
    };

export type AudioOutputSource =
  | AudioNode
  | {
      readonly output: AudioNode;
    };

export type AudioRouteNode = AudioInputTarget | AudioOutputSource;

export type AudioChannelProperties = {
  readonly channelCount: number;
  readonly channelCountMode: ChannelCountMode;
  readonly channelInterpretation: ChannelInterpretation;
};

/**
 * Returns how many inputs `target` accepts; an `AudioParam` counts as one.
 */
export function getAudioInputCount(target: AudioInputTarget): number {
  const inputTarget = getAudioInput(target);

  return isAudioParamLike(inputTarget) ? 1 : inputTarget.numberOfInputs;
}

/**
 * Returns how many outputs `source` has.
 */
export function getAudioOutputCount(source: AudioOutputSource): number {
  return getAudioOutput(source).numberOfOutputs;
}

/**
 * Returns the channel settings of the node behind `route`. For a unit, that is its input node.
 *
 * @throws {AudioGraphError} When `route` is not backed by an `AudioNode`.
 */
export function getAudioChannelProperties(route: AudioRouteNode): AudioChannelProperties {
  const node = getAudioRouteNodes(route)[0];

  if (node === undefined) {
    return AudioGraphError.invalidRoute("route has no AudioNode");
  }

  return {
    channelCount: node.channelCount,
    channelCountMode: node.channelCountMode,
    channelInterpretation: node.channelInterpretation,
  };
}

/**
 * Sets the given channel properties on every node behind `route` (a unit's input and output),
 * leaving the others unchanged.
 *
 * @throws {AudioGraphError} When `route` is not backed by an `AudioNode`.
 */
export function setAudioChannelProperties(
  route: AudioRouteNode,
  properties: Partial<AudioChannelProperties>,
): void {
  const nodes = getAudioRouteNodes(route);

  if (nodes.length === 0) {
    AudioGraphError.invalidRoute("route has no AudioNode");
  }

  for (const node of nodes) {
    if (isNumber(properties.channelCount)) {
      node.channelCount = properties.channelCount;
    }

    if (properties.channelCountMode !== undefined) {
      node.channelCountMode = properties.channelCountMode;
    }

    if (properties.channelInterpretation !== undefined) {
      node.channelInterpretation = properties.channelInterpretation;
    }
  }
}

/**
 * Connects `source` to `target` and returns `target` for chaining. Units connect through their
 * `output` and `input` nodes, and `target` may also be an `AudioParam`.
 */
export function connectAudio<TTarget extends AudioInputTarget>(
  source: AudioOutputSource,
  target: TTarget,
  output?: number,
  input?: number,
): TTarget {
  const outputNode = getAudioOutput(source);
  const inputTarget = getAudioInput(target);

  // Omitted indices default to 0 in Web Audio, so passing them explicitly is equivalent.
  if (isAudioParamLike(inputTarget)) {
    outputNode.connect(inputTarget, output ?? 0);
  } else {
    outputNode.connect(inputTarget, output ?? 0, input ?? 0);
  }

  return target;
}

/**
 * Disconnects `source` from `target`, or from everything when `target` is omitted.
 */
export function disconnectAudio(
  source: AudioOutputSource,
  target?: AudioInputTarget,
  output?: number,
  input?: number,
): void {
  const outputNode = getAudioOutput(source);

  if (target === undefined) {
    outputNode.disconnect();

    return;
  }

  const inputTarget = getAudioInput(target);

  if (isAudioParamLike(inputTarget)) {
    if (isNumber(output)) {
      outputNode.disconnect(inputTarget, output);
    } else {
      outputNode.disconnect(inputTarget);
    }

    return;
  }

  if (isNumber(output) && isNumber(input)) {
    outputNode.disconnect(inputTarget, output, input);
  } else if (isNumber(output)) {
    outputNode.disconnect(inputTarget, output);
  } else {
    outputNode.disconnect(inputTarget);
  }
}

/**
 * Connects `nodes` in series and returns the first one.
 *
 * @throws {AudioGraphError} When fewer than two nodes are given.
 */
export function chainAudio<TNodes extends readonly [AudioOutputSource, ...AudioInputTarget[]]>(
  ...nodes: TNodes
): TNodes[0] {
  if (nodes.length < 2) {
    AudioGraphError.invalidRoute("chain needs at least two nodes");
  }

  for (let i = 0; i < nodes.length - 1; i++) {
    // SAFETY: every node but the last is a source and every node but the first is a target, as
    // the tuple type requires.
    connectAudio(nodes[i] as AudioOutputSource, nodes[i + 1] as AudioInputTarget);
  }

  return nodes[0];
}

/**
 * Connects `source` to every target in parallel and returns `source`.
 */
export function fanAudio<TSource extends AudioOutputSource>(
  source: TSource,
  ...targets: AudioInputTarget[]
): TSource {
  for (const target of targets) {
    connectAudio(source, target);
  }

  return source;
}

function getAudioOutput(source: AudioOutputSource): AudioNode {
  return "output" in source ? source.output : source;
}

function getAudioInput(target: AudioInputTarget): AudioNode | AudioParam {
  return "input" in target ? target.input : target;
}

/**
 * Distinguishes params from nodes structurally, so the helpers also accept test doubles.
 */
function isAudioParamLike(value: AudioNode | AudioParam): value is AudioParam {
  return "setValueAtTime" in value;
}

function getAudioRouteNodes(route: AudioRouteNode): AudioNode[] {
  const nodes = new Set<AudioNode>();

  if ("input" in route && !isAudioParamLike(route.input)) {
    nodes.add(route.input);
  }

  if ("output" in route) {
    nodes.add(route.output);
  }

  if (!("input" in route) && !("output" in route) && !isAudioParamLike(route)) {
    nodes.add(route);
  }

  return [...nodes];
}
