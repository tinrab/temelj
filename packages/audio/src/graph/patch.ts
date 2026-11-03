import type { AudioContextLike } from "../context/context.ts";
import type { Param, ParamUnit } from "../signal/param.ts";
import type { TimeExpression, TimeScope } from "../time/time.ts";
import type {
  Blueprint,
  BlueprintConnection,
  DestinationBlueprint,
  PlayerBlueprint,
} from "./blueprint.ts";
import type { KnownBlueprint, LiveNodeFor } from "./registry.ts";

import {
  getAudioContextImmediateTime,
  getAudioContextNow,
  getNativeAudioContext,
  resumeAudioContext,
} from "../context/context.ts";
import { AudioDisposedError, AudioGraphError } from "../errors.ts";
import { isAudioParamValue } from "../guards.ts";
import { stopQuietly } from "../native.ts";
import { createParam } from "../signal/param.ts";
import { SignalBlueprint } from "../signal/signal.ts";
import { createTimeScope } from "../time/time.ts";
import { requireNonNegative } from "../validation.ts";
import {
  BlueprintParam,
  destination as createDestination,
  getConnectableOwner,
} from "./blueprint.ts";
import { createBlueprintNode, isKnownBlueprint } from "./registry.ts";

export type PlaySourceOptions = {
  /**
   * Context time to start at. Defaults to the context's scheduling time.
   */
  readonly time?: number;
  /**
   * Offset into a buffer source, in seconds.
   */
  readonly offset?: number;
  /**
   * How long to play a buffer source, in seconds.
   */
  readonly duration?: number;
};

/**
 * Blueprints that produce sound and are started explicitly.
 */
export type SourceBlueprint = Extract<
  KnownBlueprint,
  { readonly type: "bufferSource" | "noise" | "oscillator" }
>;

export interface PlayContext {
  readonly context: BaseAudioContext;
  readonly time: TimeScope;
  /**
   * Returns the native node created for `blueprint` in this playback.
   */
  readonly get: <Node extends KnownBlueprint>(blueprint: Node) => LiveNodeFor<Node>;
  readonly param: <Unit extends ParamUnit>(audioParam: AudioParam, unit: Unit) => Param<Unit>;
  /**
   * Starts a source, or a player's buffer source. The handle's playback controls, such as `pause()`
   * and `seek()`, act on the sources started this way.
   */
  readonly start: (source: SourceBlueprint | PlayerBlueprint, options?: PlaySourceOptions) => void;
  readonly stop: (source: SourceBlueprint | PlayerBlueprint, time?: number) => void;
}

export type PlayHandle = {
  readonly disposed: boolean;
  /**
   * Playback position in seconds.
   */
  readonly currentTime: number;
  /**
   * Resolves once every started source has ended, or when playback is stopped.
   */
  readonly finished: Promise<void>;
  stop(time?: number): void;
  pause(time?: number): void;
  resume(time?: number): void;
  seek(position: number): void;
  /**
   * Re-reads the blueprint graph and rewires native nodes to match it.
   */
  refresh(): void;
  dispose(): void;
};

export type PlayCallback = (context: PlayContext) => void;

type SourceState = "running" | "paused" | "ended";

type TrackedSource = {
  readonly blueprint: SourceBlueprint;
  readonly offset: number;
  readonly duration: number | undefined;
  readonly startPosition: number;
  state: SourceState;
  node: OscillatorNode | AudioBufferSourceNode;
  detachEnded: () => void;
};

/**
 * Returns every blueprint upstream of `output`, including `output`. Each blueprint comes before the
 * blueprints it feeds.
 */
export function collectUpstream(output: Blueprint): Blueprint[] {
  const visited = new Set<Blueprint>();
  const order: Blueprint[] = [];

  const visit = (node: Blueprint): void => {
    if (visited.has(node)) {
      return;
    }

    visited.add(node);

    for (const connection of node.incoming) {
      visit(connection.source);
    }

    order.push(node);
  };

  visit(output);

  return order;
}

function getNodeParam(node: AudioNode, key: string): AudioParam | undefined {
  if (!(key in node)) {
    return undefined;
  }

  // SAFETY: `key in node` is checked above, and the value is narrowed below.
  const value: unknown = node[key as keyof AudioNode];

  return isAudioParamValue(value) ? value : undefined;
}

/**
 * Constant sources (including constant signals) run for the whole playback.
 */
function isAutoStarted(blueprint: Blueprint): boolean {
  if (blueprint instanceof SignalBlueprint) {
    return "offset" in blueprint.options;
  }

  return blueprint.type === "constantSource";
}

function isScheduledSource(node: AudioNode): node is AudioScheduledSourceNode {
  return "start" in node && "stop" in node;
}

function resolveSource(source: SourceBlueprint | PlayerBlueprint): SourceBlueprint {
  return source.type === "player" ? source.source : source;
}

/**
 * The node on either side may already have been disconnected by its owner; there is nothing
 * left to undo then, and Web Audio throws `InvalidAccessError`.
 */
function disconnectQuietly(disconnect: () => void): void {
  try {
    disconnect();
  } catch {
    // Already disconnected.
  }
}

function noop(): void {
  // Placeholder until a listener is attached.
}

/**
 * One materialization of a patch: owns the native nodes and the playback clock.
 */
export class PatchPlayback implements PlayHandle {
  readonly #context: AudioContextLike;
  readonly #native: BaseAudioContext;
  readonly #output: Blueprint;
  readonly #onDispose: (playback: PatchPlayback) => void;
  readonly #nodes = new Map<Blueprint, AudioNode>();
  readonly #sources = new Map<Blueprint, TrackedSource>();
  /**
   * Native connections applied so far, keyed by the blueprint connection they mirror, with the
   * call that undoes each.
   */
  readonly #wired = new Map<BlueprintConnection, () => void>();
  /**
   * Source nodes whose `ended` event has fired.
   */
  readonly #endedNodes = new WeakSet<AudioNode>();
  readonly #finished: Promise<void>;
  #resolveFinished: () => void = noop;
  #position = 0;
  #runningSince: number | undefined;
  #stopped = false;
  #disposed = false;

  constructor(
    context: AudioContextLike,
    output: Blueprint,
    onDispose: (playback: PatchPlayback) => void,
  ) {
    this.#context = context;
    this.#native = getNativeAudioContext(context);
    this.#output = output;
    this.#onDispose = onDispose;
    this.#finished = new Promise((resolve) => {
      this.#resolveFinished = resolve;
    });
    this.refresh();
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get finished(): Promise<void> {
    return this.#finished;
  }

  get currentTime(): number {
    return this.#positionAt(this.#native.currentTime);
  }

  createPlayContext(): PlayContext {
    return {
      context: this.#native,
      time: createTimeScope({
        getImmediateTime: () => getAudioContextImmediateTime(this.#context),
        getNowTime: () => getAudioContextNow(this.#context),
      }),
      get: (blueprint) => this.#getNode(blueprint),
      param: (audioParam, unit) => createParam(audioParam, unit, () => this.#native.currentTime),
      start: (source, options) => {
        this.#startSource(resolveSource(source), options);
      },
      stop: (source, time) => {
        this.#stopSource(resolveSource(source), time);
      },
    };
  }

  stop(time: number = this.#native.currentTime): void {
    if (this.#stopped) {
      return;
    }

    this.#position = this.#positionAt(time);
    this.#runningSince = undefined;
    this.#stopped = true;

    for (const source of this.#sources.values()) {
      source.state = "ended";
      source.detachEnded();
      stopQuietly(source.node, time);
    }

    for (const [blueprint, node] of this.#nodes) {
      if (isAutoStarted(blueprint) && isScheduledSource(node)) {
        stopQuietly(node, time);
      }
    }

    this.#resolveFinished();
  }

  pause(time: number = this.#native.currentTime): void {
    if (this.#stopped || this.#runningSince === undefined) {
      return;
    }

    this.#position = this.#positionAt(time);
    this.#runningSince = undefined;

    for (const source of this.#sources.values()) {
      if (source.state === "running") {
        source.state = "paused";
        stopQuietly(source.node, time);
      }
    }
  }

  resume(time: number = this.#native.currentTime): void {
    this.#assertPlaying();

    if (this.#runningSince !== undefined) {
      return;
    }

    for (const source of this.#sources.values()) {
      if (source.state === "paused") {
        this.#restartSource(source, time);
      }
    }

    this.#runningSince = time;
  }

  seek(position: number): void {
    this.#assertPlaying();
    requireNonNegative(position, "position");
    const wasRunning = this.#runningSince !== undefined;
    this.pause();
    this.#position = position;

    if (wasRunning) {
      this.resume();
    }
  }

  /**
   * Brings the native graph in line with the blueprint graph, touching only the nodes and
   * connections that changed.
   */
  refresh(): void {
    this.#assertPlaying();
    const graph = collectUpstream(this.#output);
    const reachable = new Set(graph);

    for (const [blueprint, node] of this.#nodes) {
      if (!reachable.has(blueprint)) {
        this.#removeNode(blueprint, node);
      }
    }

    for (const blueprint of graph) {
      if (!this.#nodes.has(blueprint)) {
        this.#addNode(blueprint);
      }
    }

    const desired = new Set(graph.flatMap((blueprint) => blueprint.outgoing));

    for (const [connection, undo] of this.#wired) {
      if (!desired.has(connection)) {
        undo();
        this.#wired.delete(connection);
      }
    }

    for (const connection of desired) {
      if (!this.#wired.has(connection)) {
        this.#connect(connection);
      }
    }
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.stop();
    this.#disposed = true;

    for (const node of this.#nodes.values()) {
      node.disconnect();
    }

    this.#nodes.clear();
    this.#sources.clear();
    this.#wired.clear();
    this.#onDispose(this);
  }

  #assertPlaying(): void {
    if (this.#disposed || this.#stopped) {
      AudioDisposedError.disposed("patch playback");
    }
  }

  #getNode<Node extends KnownBlueprint>(blueprint: Node): LiveNodeFor<Node> {
    const node = this.#nodes.get(blueprint);

    if (node === undefined) {
      return AudioGraphError.blueprintNotInPatch(blueprint.type);
    }

    // SAFETY: `#nodes` maps each blueprint to the node its descriptor created.
    return node as LiveNodeFor<Node>;
  }

  #addNode(blueprint: Blueprint): void {
    if (!isKnownBlueprint(blueprint)) {
      AudioGraphError.unknownBlueprintType(blueprint.type);

      return;
    }

    const node = createBlueprintNode(this.#native, blueprint);
    this.#nodes.set(blueprint, node);

    if (isAutoStarted(blueprint) && isScheduledSource(node)) {
      node.start();
    }
  }

  /**
   * Undoes every applied connection that starts or ends at `blueprint`.
   */
  #unwire(blueprint: Blueprint): void {
    for (const undo of this.#takeWiring(blueprint)) {
      undo();
    }
  }

  /**
   * Forgets the native connections of `blueprint` and returns the calls that undo them.
   */
  #takeWiring(blueprint: Blueprint): (() => void)[] {
    const undos: (() => void)[] = [];

    for (const [connection, undo] of this.#wired) {
      if (
        connection.source === blueprint ||
        getConnectableOwner(connection.destination) === blueprint
      ) {
        undos.push(undo);
        this.#wired.delete(connection);
      }
    }

    return undos;
  }

  #removeNode(blueprint: Blueprint, node: AudioNode): void {
    this.#unwire(blueprint);
    this.#sources.get(blueprint)?.detachEnded();
    this.#sources.delete(blueprint);

    if (isScheduledSource(node)) {
      stopQuietly(node);
    }

    node.disconnect();
    this.#nodes.delete(blueprint);
  }

  #connect(connection: BlueprintConnection): void {
    const { destination, output = 0, input = 0 } = connection;
    const sourceNode = this.#nodes.get(connection.source);

    if (sourceNode === undefined) {
      return;
    }

    if (destination instanceof BlueprintParam) {
      const owner = this.#nodes.get(destination.owner);
      const param = owner === undefined ? undefined : getNodeParam(owner, destination.key);

      if (param !== undefined) {
        sourceNode.connect(param, output);
        this.#wired.set(connection, () => {
          disconnectQuietly(() => sourceNode.disconnect(param, output));
        });
      }

      return;
    }

    const destinationNode = this.#nodes.get(destination);

    if (destinationNode !== undefined) {
      sourceNode.connect(destinationNode, output, input);
      this.#wired.set(connection, () => {
        disconnectQuietly(() => sourceNode.disconnect(destinationNode, output, input));
      });
    }
  }

  #startSource(blueprint: SourceBlueprint, options: PlaySourceOptions = {}): void {
    this.#assertPlaying();
    const time = options.time ?? getAudioContextNow(this.#context);
    const previous = this.#sources.get(blueprint);
    previous?.detachEnded();

    const source: TrackedSource = {
      blueprint,
      duration: options.duration,
      offset: options.offset ?? 0,
      // Playback position at the moment the source starts, which can be later than now.
      startPosition: this.#runningSince === undefined ? this.#position : this.#positionAt(time),
      state: "running",
      // Native sources start only once, so starting the blueprint again needs a fresh node.
      node:
        previous === undefined
          ? this.#getNode(blueprint)
          : this.#replaceSourceNode(blueprint, previous.node),
      detachEnded: noop,
    };

    this.#sources.set(blueprint, source);
    this.#schedule(source, time, source.offset, source.duration);
    this.#runningSince ??= time;
  }

  #stopSource(blueprint: SourceBlueprint, time: number = this.#native.currentTime): void {
    const source = this.#sources.get(blueprint);

    if (source?.state !== "running") {
      return;
    }

    source.state = "ended";
    stopQuietly(source.node, time);
  }

  /**
   * Playback position at context time `time`.
   */
  #positionAt(time: number): number {
    if (this.#runningSince === undefined) {
      return this.#position;
    }

    return this.#position + Math.max(0, time - this.#runningSince);
  }

  /**
   * Plays a paused source again from the playback position. Native sources start only once, so
   * this builds a fresh node.
   */
  #restartSource(source: TrackedSource, time: number): void {
    // Seeking to before the source began delays it until the playback reaches its start.
    const delay = Math.max(0, source.startPosition - this.#position);
    const elapsed = Math.max(0, this.#position - source.startPosition);
    const duration = source.duration === undefined ? undefined : source.duration - elapsed;

    if (duration !== undefined && duration <= 0) {
      source.state = "ended";

      return;
    }

    source.node = this.#replaceSourceNode(source.blueprint, source.node);
    source.state = "running";
    this.#schedule(source, time + delay, source.offset + elapsed, duration);
  }

  /**
   * Builds a fresh native node for a source blueprint and wires it in place of `previous`.
   * `previous` may still be playing up to its scheduled stop, so it stays wired until it ends.
   */
  #replaceSourceNode(
    blueprint: SourceBlueprint,
    previous: OscillatorNode | AudioBufferSourceNode,
  ): OscillatorNode | AudioBufferSourceNode {
    const undos = this.#takeWiring(blueprint);

    const release = (): void => {
      for (const undo of undos) {
        undo();
      }

      previous.disconnect();
    };

    if (this.#endedNodes.has(previous)) {
      release();
    } else {
      previous.addEventListener("ended", release, { once: true });
    }

    const node = createBlueprintNode(this.#native, blueprint);
    this.#nodes.set(blueprint, node);

    // Rewire both directions: params of the old source (for example a modulated frequency) were
    // connected to the old node too.
    for (const connection of [...blueprint.outgoing, ...blueprint.incoming]) {
      this.#connect(connection);
    }

    return node;
  }

  #schedule(source: TrackedSource, time: number, offset: number, duration?: number): void {
    const { node } = source;

    const handleEnded = (): void => {
      if (source.state === "running") {
        source.state = "ended";
        this.#resolveIfFinished();
      }
    };

    source.detachEnded();
    node.addEventListener("ended", () => this.#endedNodes.add(node), { once: true });
    node.addEventListener("ended", handleEnded);
    source.detachEnded = () => {
      node.removeEventListener("ended", handleEnded);
    };

    if (!("playbackRate" in node)) {
      node.start(time);
    } else if (duration === undefined) {
      node.start(time, offset);
    } else {
      node.start(time, offset, duration);
    }
  }

  #resolveIfFinished(): void {
    for (const source of this.#sources.values()) {
      if (source.state !== "ended") {
        return;
      }
    }

    this.#position = this.currentTime;
    this.#runningSince = undefined;
    this.#resolveFinished();
  }
}

/**
 * A blueprint graph bound to a context. Each `play()` materializes fresh native nodes, except that
 * a media element keeps its one source node.
 */
export class AudioPatch {
  readonly #context: AudioContextLike;
  readonly #output: DestinationBlueprint;
  readonly #playbacks = new Set<PatchPlayback>();
  #disposed = false;

  constructor(context: AudioContextLike, output: DestinationBlueprint) {
    this.#context = context;
    this.#output = output;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  /**
   * Materializes the graph upstream of the destination, then calls `callback` to start sources. It
   * also asks the context to resume; a context that stays suspended until a user gesture starts
   * producing sound once it runs.
   */
  play(callback?: PlayCallback): PlayHandle {
    if (this.#disposed) {
      return AudioDisposedError.disposed("patch");
    }

    resumeAudioContext(this.#context).catch(() => {
      // Resuming can fail without a user gesture; playback starts once the context runs.
    });

    const playback = new PatchPlayback(this.#context, this.#output, (disposed) => {
      this.#playbacks.delete(disposed);
    });

    this.#playbacks.add(playback);
    callback?.(playback.createPlayContext());

    return playback;
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }

    this.#disposed = true;

    for (const playback of Array.from(this.#playbacks)) {
      playback.dispose();
    }
  }
}

/**
 * Binds the graph upstream of `output` to `context`. See `AudioPatch` for what each `play()`
 * creates.
 */
export function patch(context: AudioContextLike, output: DestinationBlueprint): AudioPatch {
  return new AudioPatch(context, output);
}

export type PlayPlayerOptions = PlaySourceOptions & {
  /**
   * Start time as a time expression. Takes precedence over `time`.
   */
  readonly at?: TimeExpression;
};

/**
 * Plays a player blueprint on its own destination. The player stays connected to that
 * destination until playback finishes.
 */
export function playPlayer(
  context: AudioContextLike,
  player: PlayerBlueprint,
  options: PlayPlayerOptions = {},
): PlayHandle {
  const output = createDestination();
  player.connect(output);
  const { at, ...sourceOptions } = options;

  const handle = patch(context, output).play((playContext) => {
    playContext.start(player, {
      ...sourceOptions,
      time: at === undefined ? sourceOptions.time : playContext.time.toSeconds(at),
    });
  });

  const release = (): void => {
    player.disconnect(output);
  };

  handle.finished.then(release, release);

  return handle;
}
