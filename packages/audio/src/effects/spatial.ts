import {
  getAudioContextImmediateTime,
  getNativeAudioContext,
  type AudioContextLike,
} from "../context/context.ts";
import { createPannerNode } from "../native.ts";
import { AudioNodeUnit } from "../unit.ts";

export type ListenerPosition = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

export type ListenerOrientation = {
  readonly forwardX: number;
  readonly forwardY: number;
  readonly forwardZ: number;
  readonly upX: number;
  readonly upY: number;
  readonly upZ: number;
};

export type SpatialPannerOptions = PannerOptions & {
  readonly orientation?: PannerOrientation;
  readonly position?: ListenerPosition;
};

export type PannerOrientation = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

/**
 * Whether `listener` has the position and orientation `AudioParam`s. Firefox 158 does not; it only
 * has the deprecated `setPosition()` and `setOrientation()` methods.
 */
function hasListenerParams(listener: AudioListener): boolean {
  return "positionX" in listener;
}

/**
 * Returns the listener position of `context`. Runtimes without listener params report the origin.
 */
export function getListenerPosition(context: AudioContextLike): ListenerPosition {
  const { listener } = getNativeAudioContext(context);

  if (!hasListenerParams(listener)) {
    return { x: 0, y: 0, z: 0 };
  }

  return { x: listener.positionX.value, y: listener.positionY.value, z: listener.positionZ.value };
}

/**
 * Returns the listener's forward and up vectors. Runtimes without listener params report the
 * defaults.
 */
export function getListenerOrientation(context: AudioContextLike): ListenerOrientation {
  const { listener } = getNativeAudioContext(context);

  if (!hasListenerParams(listener)) {
    return { forwardX: 0, forwardY: 0, forwardZ: -1, upX: 0, upY: 1, upZ: 0 };
  }

  return {
    forwardX: listener.forwardX.value,
    forwardY: listener.forwardY.value,
    forwardZ: listener.forwardZ.value,
    upX: listener.upX.value,
    upY: listener.upY.value,
    upZ: listener.upZ.value,
  };
}

/**
 * Moves the listener to `position` at `time` (seconds, default now). Runtimes without listener
 * params apply it immediately.
 */
export function setListenerPosition(
  context: AudioContextLike,
  position: ListenerPosition,
  time: number = getAudioContextImmediateTime(context),
): void {
  const { listener } = getNativeAudioContext(context);

  if (!hasListenerParams(listener)) {
    listener.setPosition(position.x, position.y, position.z);

    return;
  }

  listener.positionX.setValueAtTime(position.x, time);
  listener.positionY.setValueAtTime(position.y, time);
  listener.positionZ.setValueAtTime(position.z, time);
}

/**
 * Sets the listener's forward and up vectors at `time` (seconds, default now). Runtimes without
 * listener params apply it immediately.
 */
export function setListenerOrientation(
  context: AudioContextLike,
  orientation: ListenerOrientation,
  time: number = getAudioContextImmediateTime(context),
): void {
  const { listener } = getNativeAudioContext(context);

  if (!hasListenerParams(listener)) {
    listener.setOrientation(
      orientation.forwardX,
      orientation.forwardY,
      orientation.forwardZ,
      orientation.upX,
      orientation.upY,
      orientation.upZ,
    );

    return;
  }

  listener.forwardX.setValueAtTime(orientation.forwardX, time);
  listener.forwardY.setValueAtTime(orientation.forwardY, time);
  listener.forwardZ.setValueAtTime(orientation.forwardZ, time);
  listener.upX.setValueAtTime(orientation.upX, time);
  listener.upY.setValueAtTime(orientation.upY, time);
  listener.upZ.setValueAtTime(orientation.upZ, time);
}

/**
 * 3D panner with helpers for setting position and orientation. The remaining `PannerNode` settings,
 * such as the distance model, are set on `node`.
 */
export class SpatialPanner extends AudioNodeUnit {
  readonly node: PannerNode;

  constructor(context: AudioContextLike, options: SpatialPannerOptions = {}) {
    super(context);
    const { orientation, position, ...pannerOptions } = options;
    this.node = this.nodes.add(createPannerNode(this.native, pannerOptions));

    if (position !== undefined) {
      this.setPosition(position);
    }

    if (orientation !== undefined) {
      this.setOrientation(orientation);
    }
  }

  get input(): PannerNode {
    return this.node;
  }

  get output(): PannerNode {
    return this.node;
  }

  get position(): ListenerPosition {
    return {
      x: this.node.positionX.value,
      y: this.node.positionY.value,
      z: this.node.positionZ.value,
    };
  }

  get orientation(): PannerOrientation {
    return {
      x: this.node.orientationX.value,
      y: this.node.orientationY.value,
      z: this.node.orientationZ.value,
    };
  }

  setPosition(position: ListenerPosition, time: number = this.now()): void {
    this.node.positionX.setValueAtTime(position.x, time);
    this.node.positionY.setValueAtTime(position.y, time);
    this.node.positionZ.setValueAtTime(position.z, time);
  }

  setOrientation(orientation: PannerOrientation, time: number = this.now()): void {
    this.node.orientationX.setValueAtTime(orientation.x, time);
    this.node.orientationY.setValueAtTime(orientation.y, time);
    this.node.orientationZ.setValueAtTime(orientation.z, time);
  }
}
