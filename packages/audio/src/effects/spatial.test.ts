import { describe, expect, it, vi } from "vitest";

import { asNative, createMockAudioContext, createMockFacade, asMock } from "../../tests/audio.ts";
import {
  SpatialPanner,
  getListenerOrientation,
  getListenerPosition,
  setListenerOrientation,
  setListenerPosition,
} from "../mod.ts";

type MockAudioParam = {
  value: number;
  setValueAtTime: ReturnType<typeof vi.fn<(value: number, time: number) => void>>;
};

type ModernListener = {
  readonly forwardX: MockAudioParam;
  readonly forwardY: MockAudioParam;
  readonly forwardZ: MockAudioParam;
  readonly positionX: MockAudioParam;
  readonly positionY: MockAudioParam;
  readonly positionZ: MockAudioParam;
  readonly upX: MockAudioParam;
  readonly upY: MockAudioParam;
  readonly upZ: MockAudioParam;
};

function createParam(value = 0): MockAudioParam {
  const param: MockAudioParam = {
    value,
    setValueAtTime: vi.fn<(value: number, time: number) => void>((nextValue) => {
      param.value = nextValue;
    }),
  };

  return param;
}

function createModernContext(currentTime = 1) {
  const listener: ModernListener = {
    forwardX: createParam(),
    forwardY: createParam(),
    forwardZ: createParam(),
    positionX: createParam(),
    positionY: createParam(),
    positionZ: createParam(),
    upX: createParam(),
    upY: createParam(),
    upZ: createParam(),
  };

  return {
    currentTime,
    listener,
    native: asNative<BaseAudioContext>({ currentTime, listener }),
  };
}

describe("spatial listener utilities", () => {
  it("reads modern listener position and orientation params", () => {
    const context = createModernContext(2);
    const { listener } = context;
    listener.positionX.value = 1;
    listener.positionY.value = 2;
    listener.positionZ.value = 3;
    listener.forwardX.value = 0;
    listener.forwardY.value = 0;
    listener.forwardZ.value = -1;
    listener.upX.value = 0;
    listener.upY.value = 1;
    listener.upZ.value = 0;

    expect(getListenerPosition(context.native)).toEqual({ x: 1, y: 2, z: 3 });
    expect(getListenerOrientation(context.native)).toEqual({
      forwardX: 0,
      forwardY: 0,
      forwardZ: -1,
      upX: 0,
      upY: 1,
      upZ: 0,
    });
  });

  it("returns listener defaults when legacy listener fields are not readable", () => {
    const context = asNative<BaseAudioContext>({
      currentTime: 1,
      listener: {},
    });

    expect(getListenerPosition(context)).toEqual({ x: 0, y: 0, z: 0 });
    expect(getListenerOrientation(context)).toEqual({
      forwardX: 0,
      forwardY: 0,
      forwardZ: -1,
      upX: 0,
      upY: 1,
      upZ: 0,
    });
  });

  it("sets modern listener position params at the context immediate time", () => {
    const context = createModernContext(2);
    const { listener } = context;

    setListenerPosition(context.native, { x: 1, y: 2, z: 3 });

    expect(listener.positionX.setValueAtTime.mock.calls).toEqual([[1, 2]]);
    expect(listener.positionY.setValueAtTime.mock.calls).toEqual([[2, 2]]);
    expect(listener.positionZ.setValueAtTime.mock.calls).toEqual([[3, 2]]);
  });

  it("sets modern listener orientation params with an explicit time", () => {
    const context = createModernContext(2);
    const { listener } = context;

    setListenerOrientation(
      context.native,
      {
        forwardX: 0,
        forwardY: 0,
        forwardZ: -1,
        upX: 0,
        upY: 1,
        upZ: 0,
      },
      5,
    );

    expect(listener.forwardZ.setValueAtTime.mock.calls).toEqual([[-1, 5]]);
    expect(listener.upY.setValueAtTime.mock.calls).toEqual([[1, 5]]);
  });

  it("uses facade immediate time rather than lookahead time", () => {
    const context = createModernContext(2);
    const facade = createMockFacade(asNative<AudioContext>(context.native), 0.5);
    const { listener } = context;

    setListenerPosition(facade, { x: 1, y: 2, z: 3 });

    expect(listener.positionX.setValueAtTime.mock.calls).toEqual([[1, 2]]);
  });

  it("falls back to legacy listener methods", () => {
    const context = asNative<BaseAudioContext>({
      currentTime: 1,
      listener: {
        setOrientation:
          vi.fn<
            (
              forwardX: number,
              forwardY: number,
              forwardZ: number,
              upX: number,
              upY: number,
              upZ: number,
            ) => void
          >(),
        setPosition: vi.fn<(x: number, y: number, z: number) => void>(),
      },
    });

    const listener = asMock<{
      setOrientation: ReturnType<
        typeof vi.fn<
          (
            forwardX: number,
            forwardY: number,
            forwardZ: number,
            upX: number,
            upY: number,
            upZ: number,
          ) => void
        >
      >;
      setPosition: ReturnType<typeof vi.fn<(x: number, y: number, z: number) => void>>;
    }>(context.listener);

    setListenerPosition(context, { x: 1, y: 2, z: 3 });
    setListenerOrientation(context, {
      forwardX: 0,
      forwardY: 0,
      forwardZ: -1,
      upX: 0,
      upY: 1,
      upZ: 0,
    });

    expect(listener.setPosition.mock.calls).toEqual([[1, 2, 3]]);
    expect(listener.setOrientation.mock.calls).toEqual([[0, 0, -1, 0, 1, 0]]);
  });

  it("schedules panner position and orientation params", () => {
    const context = createMockAudioContext(2);

    const spatial = new SpatialPanner(context, {
      distanceModel: "linear",
      orientation: { x: 0, y: 0, z: -1 },
      position: { x: 1, y: 2, z: 3 },
    });

    const panner = context.createdSpatialPanners[0]!;

    expect(spatial.node.distanceModel).toBe("linear");
    expect(panner.positionX.setValueAtTime.mock.calls).toEqual([[1, 2]]);
    expect(panner.orientationZ.setValueAtTime.mock.calls).toEqual([[-1, 2]]);
    expect(spatial.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(spatial.orientation).toEqual({ x: 0, y: 0, z: -1 });

    spatial.setPosition({ x: 4, y: 5, z: 6 }, 7);
    expect(panner.positionZ.setValueAtTime.mock.calls.at(-1)).toEqual([6, 7]);

    spatial.dispose();
    spatial.dispose();
    expect(panner.disconnect).toHaveBeenCalledTimes(1);
  });

  it("uses facade immediate time for panner updates", () => {
    const native = createMockAudioContext(3);
    const spatial = new SpatialPanner(createMockFacade(asNative<AudioContext>(native), 0.5));

    spatial.setPosition({ x: 1, y: 0, z: 0 });
    expect(native.createdSpatialPanners[0]!.positionX.setValueAtTime.mock.calls).toEqual([[1, 3]]);
  });
});
