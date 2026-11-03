import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { asNative, asMock } from "../../tests/audio.ts";
import {
  GlobalMockAudioContext as MockAudioContext,
  GlobalMockOfflineAudioContext as MockOfflineAudioContext,
  installContextTestGlobals,
} from "../../tests/context.ts";
import { AudioUnsupportedError } from "../errors.ts";
import {
  createAudioContext,
  createOfflineAudioContext,
  closeAudioContext,
  getAudioContextImmediateTime,
  getAudioContextNow,
  getNativeAudioContext,
  OfflineAudioContextFacade,
  onAudioContextRunning,
  OnlineAudioContextFacade,
  resumeAudioContext,
  suspendAudioContext,
  waitForAudioContextState,
  AudioContextFacade,
} from "../mod.ts";

let restoreContextTestGlobals: () => void;

beforeEach(() => {
  restoreContextTestGlobals = installContextTestGlobals();
});

afterEach(() => {
  restoreContextTestGlobals();
});

describe("createAudioContext", () => {
  it("returns an OnlineAudioContextFacade when audio is supported", () => {
    const ctx = createAudioContext();
    expect(ctx).toBeInstanceOf(OnlineAudioContextFacade);
    expect(ctx.state).toBe("suspended");
  });

  it("is idempotent for repeated resume calls", async () => {
    const audioContext = new MockAudioContext();

    const native = new OnlineAudioContextFacade(asNative<AudioContext>(audioContext), {});

    await native.resume();
    await native.resume();

    expect(audioContext.resume).toHaveBeenCalledTimes(1);
  });

  it("is idempotent for repeated suspend calls", async () => {
    const audioContext = new MockAudioContext();

    const native = new OnlineAudioContextFacade(asNative<AudioContext>(audioContext), {});

    await native.resume();
    await native.suspend();
    await native.suspend();

    expect(audioContext.suspend).toHaveBeenCalledTimes(1);
  });

  it("is idempotent for repeated close calls", async () => {
    const audioContext = new MockAudioContext();

    const native = new OnlineAudioContextFacade(asNative<AudioContext>(audioContext), {});

    await native.close();
    await native.close();

    expect(audioContext.close).toHaveBeenCalledTimes(1);
  });

  it("applies lookAhead to now() but not immediate()", () => {
    const ctx = createAudioContext({
      lookAhead: 0.5,
    });

    asMock<{ currentTime: number }>(ctx.context).currentTime = 10;

    expect(ctx.now()).toBe(10.5);
    expect(ctx.immediate()).toBe(10);
  });

  it("honors autoResume option false", () => {
    const ctx = createAudioContext({ autoResume: false });
    expect(ctx).toBeInstanceOf(OnlineAudioContextFacade);
    void ctx.resume();
  });

  it("throws AudioUnsupportedError when audio is unsupported", () => {
    Reflect.deleteProperty(globalThis, "AudioContext");
    expect(() => createAudioContext()).toThrow(AudioUnsupportedError);
  });
});

describe("context utilities", () => {
  it("unwraps facades and reads immediate and lookahead times", () => {
    const facade = createAudioContext({
      lookAhead: 0.25,
    });

    asMock<{ currentTime: number }>(facade.context).currentTime = 2;

    expect(facade instanceof AudioContextFacade).toBe(true);
    expect(getNativeAudioContext(facade)).toBe(facade.context);
    expect(getAudioContextImmediateTime(facade)).toBe(2);
    expect(getAudioContextNow(facade)).toBe(2.25);

    const native = asNative<AudioContext>(new MockAudioContext());
    asMock<{ currentTime: number }>(native).currentTime = 3;

    expect(native instanceof AudioContextFacade).toBe(false);
    expect(getNativeAudioContext(native)).toBe(native);
    expect(getAudioContextImmediateTime(native)).toBe(3);
    expect(getAudioContextNow(native)).toBe(3);
  });

  it("resumes, suspends, and closes raw online contexts idempotently", async () => {
    const native = new MockAudioContext();

    await resumeAudioContext(asNative<AudioContext>(native));
    await resumeAudioContext(asNative<AudioContext>(native));

    expect(native.resume).toHaveBeenCalledTimes(1);
    expect(native.state).toBe("running");

    await suspendAudioContext(asNative<AudioContext>(native));
    await suspendAudioContext(asNative<AudioContext>(native));

    expect(native.suspend).toHaveBeenCalledTimes(1);
    expect(native.state).toBe("suspended");

    await closeAudioContext(asNative<AudioContext>(native));
    await closeAudioContext(asNative<AudioContext>(native));

    expect(native.close).toHaveBeenCalledTimes(1);
    expect(native.state).toBe("closed");
  });

  it("uses facade lifecycle methods and detects offline facades", async () => {
    const online = createAudioContext({ autoResume: false });

    const offline = createOfflineAudioContext({
      numberOfChannels: 1,
      length: 1,
      sampleRate: 44_100,
    });

    expect(online instanceof OfflineAudioContextFacade).toBe(false);
    expect(offline instanceof OfflineAudioContextFacade).toBe(true);

    await resumeAudioContext(online);
    expect(online.state).toBe("running");

    await suspendAudioContext(online);
    expect(online.state).toBe("suspended");

    await closeAudioContext(online);
    expect(online.state).toBe("closed");
  });

  it("does not call raw OfflineAudioContext suspend without a suspend time", async () => {
    const native = new MockOfflineAudioContext();
    native.state = "running";

    await suspendAudioContext(asNative<OfflineAudioContext>(native));

    expect(native.suspend).not.toHaveBeenCalled();
  });

  it("does not resume offline contexts before rendering", async () => {
    const native = new MockOfflineAudioContext();
    const facade = new OfflineAudioContextFacade(asNative<OfflineAudioContext>(native));

    await resumeAudioContext(asNative<OfflineAudioContext>(native));
    await resumeAudioContext(facade);

    expect(native.resume).not.toHaveBeenCalled();
  });

  it("waits for context state changes through raw contexts and facades", async () => {
    const native = new MockAudioContext();
    const rawWait = waitForAudioContextState(asNative<AudioContext>(native), "running");

    await native.resume();

    await expect(rawWait).resolves.toBe("running");
    expect(native.addEventListener).toHaveBeenCalledWith("statechange", expect.any(Function));
    expect(native.removeEventListener).toHaveBeenCalledWith("statechange", expect.any(Function));

    const facade = new OnlineAudioContextFacade(asNative<AudioContext>(native), {});

    const facadeWait = waitForAudioContextState(facade, ["suspended", "closed"]);

    await facade.suspend();

    await expect(facadeWait).resolves.toBe("suspended");
  });

  it("runs callbacks once an online context reaches running state", async () => {
    const native = new MockAudioContext();
    const callback = vi.fn<(state: BaseAudioContext["state"]) => void>();

    const unsubscribe = onAudioContextRunning(asNative<AudioContext>(native), callback);

    expect(callback).not.toHaveBeenCalled();
    expect(native.addEventListener).toHaveBeenCalledWith("statechange", expect.any(Function));

    await native.resume();

    expect(callback).toHaveBeenCalledExactlyOnceWith("running");
    expect(native.removeEventListener).toHaveBeenCalledWith("statechange", expect.any(Function));

    await native.suspend();
    await native.resume();
    unsubscribe();

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("can unsubscribe a pending running-state callback", async () => {
    const native = new MockAudioContext();
    const callback = vi.fn<(state: BaseAudioContext["state"]) => void>();

    const unsubscribe = onAudioContextRunning(asNative<AudioContext>(native), callback);
    unsubscribe();

    await native.resume();

    expect(callback).not.toHaveBeenCalled();
    expect(native.removeEventListener).toHaveBeenCalledWith("statechange", expect.any(Function));
  });

  it("runs immediately for already-running and offline contexts", () => {
    const online = new MockAudioContext();
    online.state = "running";
    const onlineCallback = vi.fn<(state: BaseAudioContext["state"]) => void>();

    const unsubscribeOnline = onAudioContextRunning(asNative<AudioContext>(online), onlineCallback);

    expect(onlineCallback).toHaveBeenCalledExactlyOnceWith("running");
    expect(online.addEventListener).not.toHaveBeenCalled();
    unsubscribeOnline();

    const offline = new MockOfflineAudioContext();
    const offlineCallback = vi.fn<(state: BaseAudioContext["state"]) => void>();

    const unsubscribeOffline = onAudioContextRunning(
      asNative<OfflineAudioContext>(offline),
      offlineCallback,
    );

    expect(offlineCallback).toHaveBeenCalledExactlyOnceWith("suspended");
    expect(offline.addEventListener).not.toHaveBeenCalled();
    unsubscribeOffline();
  });

  it("resolves immediately when the context is already in a target state", async () => {
    const native = new MockAudioContext();
    native.state = "running";

    await expect(
      waitForAudioContextState(asNative<AudioContext>(native), ["running", "closed"]),
    ).resolves.toBe("running");

    expect(native.addEventListener).not.toHaveBeenCalled();
  });

  it("supports aborting and timing out state waits", async () => {
    const native = new MockAudioContext();
    const controller = new AbortController();

    const aborted = waitForAudioContextState(asNative<AudioContext>(native), "running", {
      signal: controller.signal,
    });

    controller.abort();

    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    expect(() =>
      waitForAudioContextState(asNative<AudioContext>(native), "running", {
        timeoutMs: -1,
      }),
    ).toThrow("timeoutMs");
    await expect(
      waitForAudioContextState(asNative<AudioContext>(native), "running", {
        timeoutMs: 0,
      }),
    ).rejects.toThrow("timed out");
  });
});

describe("createOfflineAudioContext", () => {
  it("returns an OfflineAudioContextFacade when OfflineAudioContext is available", async () => {
    const ctx = createOfflineAudioContext({
      numberOfChannels: 1,
      length: 1,
      sampleRate: 44_100,
    });

    expect(ctx).toBeInstanceOf(OfflineAudioContextFacade);
    await expect(ctx.render()).resolves.toEqual({ duration: 0 });
  });

  it("throws AudioUnsupportedError when OfflineAudioContext is unavailable", () => {
    Reflect.deleteProperty(globalThis, "OfflineAudioContext");
    expect(() => createOfflineAudioContext({ length: 1, sampleRate: 44_100 })).toThrow(
      AudioUnsupportedError,
    );
  });
});
