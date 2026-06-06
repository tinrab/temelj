// @vitest-environment jsdom
/* oxlint-disable typescript/no-floating-promises, vitest/require-mock-type-parameters */
import { err, ok } from "@temelj/result";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import "../test/setup.ts";
import { mockMatchMedia, mockResizeObserver } from "../test/browser-mocks.ts";
import { useBattery } from "./use-battery.ts";
import { useBeforeUnload } from "./use-before-unload.ts";
import { useBreakpoint } from "./use-breakpoint.ts";
import { useClickAway } from "./use-click-away.ts";
import { useClipboardResult } from "./use-clipboard-result.ts";
import { useColorScheme } from "./use-color-scheme.ts";
import { useCopyToClipboard } from "./use-copy-to-clipboard.ts";
import { useDocumentEvent } from "./use-document-event.ts";
import { useDocumentTitle } from "./use-document-title.ts";
import { useEventListenerRef } from "./use-event-listener-ref.ts";
import { useEventListener } from "./use-event-listener.ts";
import { useFavicon } from "./use-favicon.ts";
import { useFocusReturn } from "./use-focus-return.ts";
import { useFocusTrap } from "./use-focus-trap.ts";
import { useGeolocation } from "./use-geolocation.ts";
import { useHover } from "./use-hover.ts";
import { useIdle } from "./use-idle.ts";
import { useIntersectionObserver } from "./use-intersection-observer.ts";
import { useIsClient } from "./use-is-client.ts";
import { useIsMobile } from "./use-is-mobile.ts";
import { useKeyPress } from "./use-key-press.ts";
import { useLocalStorage } from "./use-local-storage.ts";
import { useLockBodyScroll } from "./use-lock-body-scroll.ts";
import { useLongPress } from "./use-long-press.ts";
import { useMeasure } from "./use-measure.ts";
import { useMediaQueries } from "./use-media-queries.ts";
import { useMediaQuery } from "./use-media-query.ts";
import { assignRef, useMergedRefs } from "./use-merged-refs.ts";
import { useMouse } from "./use-mouse.ts";
import { useMutationObserver } from "./use-mutation-observer.ts";
import { useNetworkState } from "./use-network-state.ts";
import { useOnlineResult } from "./use-online-result.ts";
import { useOrientation } from "./use-orientation.ts";
import { usePageLeave } from "./use-page-leave.ts";
import { usePreferredLanguage } from "./use-preferred-language.ts";
import { usePrefersReducedMotion } from "./use-prefers-reduced-motion.ts";
import { useScript } from "./use-script.ts";
import { useScrollLock } from "./use-scroll-lock.ts";
import { useSessionStorage } from "./use-session-storage.ts";
import { useVisibilityChange } from "./use-visibility-change.ts";
import { useWindowEvent } from "./use-window-event.ts";
import { useWindowScroll } from "./use-window-scroll.ts";
import { useWindowSize } from "./use-window-size.ts";

function setNavigatorValue<K extends keyof Navigator>(key: K, value: Navigator[K]) {
  Object.defineProperty(navigator, key, {
    configurable: true,
    value,
  });
}

function setDocumentValue<K extends keyof Document>(key: K, value: Document[K]) {
  Object.defineProperty(document, key, {
    configurable: true,
    value,
  });
}

describe("browser hooks", () => {
  it("media-query hooks subscribe to matchMedia changes", async () => {
    const lists = mockMatchMedia((query) => query.includes("min-width"));

    const media = renderHook(() => useMediaQuery("(min-width: 600px)"));
    expect(media.result.current).toBe(true);
    act(() => lists.get("(min-width: 600px)")?.setMatches(false));
    expect(media.result.current).toBe(false);

    const queries = renderHook(() =>
      useMediaQueries({ wide: "(min-width: 800px)", reduced: "(prefers-reduced-motion)" }),
    );
    await waitFor(() => expect(queries.result.current.wide).toBe(true));
    expect(queries.result.current.reduced).toBe(false);

    const breakpoint = renderHook(() => useBreakpoint({ sm: 320, lg: 1024 }));
    expect(breakpoint.result.current).toBe("lg");

    expect(renderHook(() => useIsMobile(700)).result.current).toBe(false);
    expect(renderHook(() => useColorScheme()).result.current).toBe("light");
    expect(renderHook(() => usePrefersReducedMotion()).result.current).toBe(false);
  });

  it("document metadata hooks update title and favicon", () => {
    renderHook(() => useDocumentTitle("Temelj"));
    expect(document.title).toBe("Temelj");

    renderHook(() => useFavicon("/favicon.ico"));
    const icon = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    expect(icon?.href).toMatch(/\/favicon\.ico$/);
  });

  it("event listener hooks attach to window, document, elements, and callback refs", () => {
    const element = document.createElement("button");
    document.body.appendChild(element);
    const elementClick = vi.fn();
    renderHook(() => useEventListener(element, "click", elementClick));
    act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(elementClick).toHaveBeenCalledTimes(1);

    const windowResize = vi.fn();
    renderHook(() => useWindowEvent("resize", windowResize));
    act(() => window.dispatchEvent(new Event("resize")));
    expect(windowResize).toHaveBeenCalledTimes(1);

    const documentClick = vi.fn();
    renderHook(() => useDocumentEvent("click", documentClick));
    act(() => document.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(documentClick).toHaveBeenCalledTimes(1);

    const refClick = vi.fn();
    const refHook = renderHook(() => useEventListenerRef("click", refClick));
    act(() => refHook.result.current(element));
    act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(refClick).toHaveBeenCalledTimes(1);
  });

  it("useClickAway and useHover react to DOM events", () => {
    const inside = document.createElement("div");
    const outside = document.createElement("button");
    document.body.append(inside, outside);
    const away = vi.fn();
    const clickAway = renderHook(() => useClickAway<HTMLDivElement>(away));
    act(() => {
      clickAway.result.current.current = inside;
    });
    act(() => outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(away).toHaveBeenCalledTimes(1);

    const hover = renderHook(() => useHover<HTMLDivElement>());
    act(() => hover.result.current[0](inside));
    act(() => inside.dispatchEvent(new MouseEvent("mouseenter")));
    expect(hover.result.current[1]).toBe(true);
    act(() => inside.dispatchEvent(new MouseEvent("mouseleave")));
    expect(hover.result.current[1]).toBe(false);
  });

  it("storage hooks initialize, update, and remove stored values", () => {
    const local = renderHook(() => useLocalStorage("local-test", 1));
    expect(local.result.current[0]).toBe(1);
    act(() => local.result.current[1](2));
    expect(local.result.current[0]).toBe(2);
    expect(window.localStorage.getItem("local-test")).toBe("2");

    const session = renderHook(() => useSessionStorage("session-test", "a"));
    act(() => session.result.current[1](null));
    expect(window.sessionStorage.getItem("session-test")).toBeNull();
    expect(session.result.current[0]).toBe("a");
  });

  it("clipboard hooks copy text and return Result state", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const copy = renderHook(() => useCopyToClipboard());
    await act(async () => {
      await copy.result.current[1]("hello");
    });
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(copy.result.current[0]).toBe("hello");

    const result = renderHook(() => useClipboardResult((error) => (error as Error).message));
    await act(async () => {
      await result.result.current.copy("world");
    });
    expect(result.result.current.result).toEqual(ok(undefined));

    writeText.mockRejectedValueOnce(new Error("denied"));
    await act(async () => {
      await result.result.current.copy("nope");
    });
    expect(result.result.current.result).toEqual(err("denied"));
  });

  it("geolocation, battery, network, orientation, language, and visibility hooks read browser APIs", async () => {
    setNavigatorValue("geolocation", {
      getCurrentPosition: vi.fn((success: PositionCallback) =>
        success({
          coords: {
            latitude: 46,
            longitude: 14,
            accuracy: 1,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
          },
          timestamp: 123,
        } as GeolocationPosition),
      ),
      watchPosition: vi.fn(() => 1),
      clearWatch: vi.fn(),
    } as Geolocation);
    const geo = renderHook(() => useGeolocation());
    await waitFor(() => expect(geo.result.current.latitude).toBe(46));

    const batteryTarget = new EventTarget() as EventTarget & {
      level: number;
      charging: boolean;
      chargingTime: number;
      dischargingTime: number;
    };
    batteryTarget.level = 0.5;
    batteryTarget.charging = true;
    batteryTarget.chargingTime = 10;
    batteryTarget.dischargingTime = Infinity;
    Object.defineProperty(navigator, "getBattery", {
      configurable: true,
      value: vi.fn().mockResolvedValue(batteryTarget),
    });
    const battery = renderHook(() => useBattery());
    await waitFor(() => expect(battery.result.current.level).toBe(0.5));

    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const network = renderHook(() => useNetworkState());
    expect(network.result.current.online).toBe(false);
    expect(renderHook(() => useOnlineResult()).result.current.kind).toBe("error");

    Object.defineProperty(screen, "orientation", {
      configurable: true,
      value: {
        angle: 90,
        type: "landscape-primary",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    expect(renderHook(() => useOrientation()).result.current).toEqual({
      angle: 90,
      type: "landscape-primary",
    });

    setNavigatorValue("language", "sl-SI");
    expect(renderHook(() => usePreferredLanguage()).result.current).toBe("sl-SI");

    setDocumentValue("visibilityState", "hidden");
    const visibility = renderHook(() => useVisibilityChange());
    expect(visibility.result.current).toBe(false);
  });

  it("idle, key-press, page-leave, beforeunload, and long-press hooks react to events", () => {
    vi.useFakeTimers();

    const idle = renderHook(() => useIdle(10));
    expect(idle.result.current).toBe(false);
    act(() => vi.advanceTimersByTime(10));
    expect(idle.result.current).toBe(true);
    act(() => window.dispatchEvent(new MouseEvent("mousemove")));
    expect(idle.result.current).toBe(false);

    const keyCallback = vi.fn();
    renderHook(() => useKeyPress("k", keyCallback));
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k" })));
    expect(keyCallback).toHaveBeenCalledTimes(1);

    const leave = vi.fn();
    renderHook(() => usePageLeave(leave));
    act(() => document.dispatchEvent(new MouseEvent("mouseout", { clientY: 0 })));
    expect(leave).toHaveBeenCalledTimes(1);

    renderHook(() => useBeforeUnload(true, "leave?"));
    const beforeUnload = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    act(() => window.dispatchEvent(beforeUnload));
    expect(beforeUnload.defaultPrevented).toBe(true);

    const longPress = vi.fn();
    const handlers = renderHook(() => useLongPress(longPress, { threshold: 10 }));
    act(() => handlers.result.current.onMouseDown({} as React.MouseEvent));
    act(() => handlers.result.current.onMouseDown({} as React.MouseEvent));
    act(() => vi.advanceTimersByTime(10));
    expect(longPress).toHaveBeenCalledTimes(1);
  });

  it("measurement and observer hooks emit entries", () => {
    const resizeCallbacks = mockResizeObserver();
    const element = document.createElement("div");
    element.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 10,
      bottom: 20,
      width: 10,
      height: 20,
      toJSON: () => ({}),
    }));

    const measure = renderHook(() => useMeasure<HTMLDivElement>());
    act(() => measure.result.current[0](element));
    expect(measure.result.current[1]).toEqual({ width: 10, height: 20 });

    const mutation = renderHook(() => useMutationObserver<HTMLDivElement>({ childList: true }));
    act(() => mutation.result.current[0](element));
    expect(mutation.result.current[1]).toEqual([]);

    const resizeObserver = renderHook(() => useMeasure<HTMLDivElement>());
    act(() => resizeObserver.result.current[0](element));
    act(() => {
      resizeCallbacks.at(-1)?.(
        [{ target: element } as unknown as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });
    expect(resizeObserver.result.current[1].width).toBe(10);
  });

  it("intersection observer and script hooks track external DOM resources", () => {
    let intersectionCallback: IntersectionObserverCallback | undefined;
    class MockIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
      }
      observe = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    const element = document.createElement("div");
    const intersection = renderHook(() => useIntersectionObserver<HTMLDivElement>());
    act(() => intersection.result.current[0](element));
    act(() => {
      intersectionCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
    expect(intersection.result.current[1]?.isIntersecting).toBe(true);

    const script = renderHook(() => useScript("/script.js", { removeOnUnmount: true }));
    const scriptElement = document.querySelector<HTMLScriptElement>("script[src='/script.js']");
    expect(script.result.current).toBe("loading");
    act(() => scriptElement?.dispatchEvent(new Event("load")));
    expect(script.result.current).toBe("ready");
    script.unmount();
    expect(document.querySelector("script[src='/script.js']")).toBeNull();
  });

  it("focus and scroll lock hooks manage focused elements and overflow", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const focusReturn = renderHook(({ enabled }) => useFocusReturn(enabled), {
      initialProps: { enabled: true },
    });
    const other = document.createElement("button");
    document.body.appendChild(other);
    other.focus();
    focusReturn.rerender({ enabled: false });
    expect(document.activeElement).toBe(trigger);

    const focusTrap = renderHook(({ enabled }) => useFocusTrap<HTMLDivElement>(enabled), {
      initialProps: { enabled: false },
    });
    const container = document.createElement("div");
    container.tabIndex = -1;
    document.body.appendChild(container);
    act(() => {
      focusTrap.result.current.current = container;
    });
    focusTrap.rerender({ enabled: true });
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
    act(() => container.dispatchEvent(event));
    expect(document.activeElement).toBe(container);

    const lock = renderHook(() => useLockBodyScroll());
    expect(document.body.style.overflow).toBe("hidden");
    lock.unmount();

    const scrollLock = renderHook(({ enabled }) => useScrollLock(enabled), {
      initialProps: { enabled: true },
    });
    expect(document.body.style.overflow).toBe("hidden");
    scrollLock.rerender({ enabled: false });
    expect(document.body.style.overflow).toBe("");
  });

  it("mouse, window size, window scroll, and ref helpers expose DOM state", () => {
    const mouse = renderHook(() => useMouse<HTMLDivElement>());
    act(() => document.dispatchEvent(new MouseEvent("mousemove", { clientX: 5, clientY: 6 })));
    expect(mouse.result.current[0].x).toBe(5);

    Object.defineProperty(window, "innerWidth", { configurable: true, value: 111 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 222 });
    const size = renderHook(() => useWindowSize());
    expect(size.result.current).toEqual({ width: 111, height: 222 });

    Object.defineProperty(window, "scrollX", { configurable: true, value: 3 });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 4 });
    window.scrollTo = vi.fn();
    const scroll = renderHook(() => useWindowScroll());
    expect(scroll.result.current[0]).toEqual({ x: 3, y: 4 });
    act(() => scroll.result.current[1](10, 20));
    expect(window.scrollTo).toHaveBeenCalledWith(10, 20);

    const node = document.createElement("div");
    const objectRef = { current: null as HTMLDivElement | null };
    const callbackRef = vi.fn();
    assignRef(objectRef, node);
    expect(objectRef.current).toBe(node);
    const merged = renderHook(() => useMergedRefs(objectRef, callbackRef));
    act(() => merged.result.current(node));
    expect(callbackRef).toHaveBeenCalledWith(node);
  });

  it("useIsClient returns true after client effect", async () => {
    const { result } = renderHook(() => useIsClient());
    await waitFor(() => expect(result.current).toBe(true));
  });
});
