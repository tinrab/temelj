// @vitest-environment jsdom
/* oxlint-disable typescript/no-floating-promises, vitest/require-mock-type-parameters */
import { act, fireEvent, render, renderHook } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import "../test/setup.ts";
import { mockResizeObserver } from "../test/browser-mocks.ts";
import { useDragRect } from "./use-drag-rect.ts";
import { useDragVector } from "./use-drag-vector.ts";
import { useElementCenter } from "./use-element-center.ts";
import { useElementRect } from "./use-element-rect.ts";
import { useMouseVector } from "./use-mouse-vector.ts";
import { usePointerVector } from "./use-pointer-vector.ts";
import { useRectIntersection } from "./use-rect-intersection.ts";
import { useRect } from "./use-rect.ts";
import { useResizeObserver } from "./use-resize-observer.ts";

function elementWithRect(rect: Partial<DOMRect>): HTMLDivElement {
  const element = document.createElement("div");
  element.getBoundingClientRect = vi.fn(() => ({
    x: rect.x ?? rect.left ?? 0,
    y: rect.y ?? rect.top ?? 0,
    left: rect.left ?? rect.x ?? 0,
    top: rect.top ?? rect.y ?? 0,
    right: rect.right ?? (rect.left ?? rect.x ?? 0) + (rect.width ?? 0),
    bottom: rect.bottom ?? (rect.top ?? rect.y ?? 0) + (rect.height ?? 0),
    width: rect.width ?? 0,
    height: rect.height ?? 0,
    toJSON: () => ({}),
  }));
  element.setPointerCapture = vi.fn();
  element.releasePointerCapture = vi.fn();

  return element;
}

describe("math hooks", () => {
  it("useRect, useElementRect, and useElementCenter measure DOM geometry", () => {
    mockResizeObserver();
    const element = elementWithRect({ left: 10, top: 20, width: 30, height: 40 });

    const rect = renderHook(() => useRect<HTMLDivElement>());
    act(() => rect.result.current[0](element));
    expect(rect.result.current[1]).toEqual({
      position: { x: 10, y: 20 },
      size: { x: 30, y: 40 },
    });

    const elementRect = renderHook(() => useElementRect<HTMLDivElement>());
    act(() => elementRect.result.current[0](element));
    expect(elementRect.result.current[1]?.size).toEqual({ x: 30, y: 40 });

    const center = renderHook(() => useElementCenter<HTMLDivElement>());
    act(() => center.result.current[0](element));
    expect(center.result.current[1]).toEqual({ x: 25, y: 40 });
  });

  it("useResizeObserver stores the latest observer entry and calls onResize", () => {
    const callbacks = mockResizeObserver();
    const onResize = vi.fn();
    const element = elementWithRect({ width: 10, height: 20 });
    const { result } = renderHook(() => useResizeObserver<HTMLDivElement>({ onResize }));

    act(() => result.current[0](element));
    let entry: ResizeObserverEntry | undefined;
    act(() => {
      entry = callbacks.at(-1)?.emit(element);
    });

    expect(result.current[1]).toBe(entry);
    expect(onResize).toHaveBeenCalledWith(entry);
  });

  it("useMouseVector and usePointerVector track viewport and relative positions", () => {
    const mouse = renderHook(() => useMouseVector<HTMLDivElement>());
    act(() => document.dispatchEvent(new MouseEvent("mousemove", { clientX: 7, clientY: 8 })));
    expect(mouse.result.current[0]).toEqual({ x: 7, y: 8 });

    const pointer = renderHook(() => usePointerVector<HTMLDivElement>());
    const element = elementWithRect({ left: 5, top: 6, width: 10, height: 10 });
    act(() => {
      pointer.result.current[1].current = element;
    });
    act(() => window.dispatchEvent(new PointerEvent("pointermove", { clientX: 15, clientY: 18 })));
    expect(pointer.result.current[0]).toEqual({ x: 10, y: 12 });
  });

  it("useRectIntersection reports overlap between two measured refs", () => {
    mockResizeObserver();
    const first = elementWithRect({ left: 0, top: 0, width: 20, height: 20 });
    const second = elementWithRect({ left: 10, top: 10, width: 20, height: 20 });
    const { result } = renderHook(() => useRectIntersection<HTMLDivElement, HTMLDivElement>());

    act(() => result.current[0](first));
    act(() => result.current[1](second));

    expect(result.current[2].intersects).toBe(true);
  });

  it("useDragVector tracks real React pointer events", () => {
    function Draggable() {
      const { ref, dragging, start, delta, onPointerDown, onPointerMove, onPointerUp } =
        useDragVector<HTMLDivElement>();

      return createElement("div", {
        ref,
        onPointerDown,
        onPointerMove,
        onPointerUp,
        "data-testid": "drag",
        "data-dragging": dragging,
        "data-start": JSON.stringify(start),
        "data-delta": JSON.stringify(delta),
      });
    }

    const view = render(createElement(Draggable));
    const node = view.getByTestId("drag");
    node.getBoundingClientRect = () => new DOMRect(10, 20, 100, 100);
    node.setPointerCapture = vi.fn<(id: number) => void>();
    node.releasePointerCapture = vi.fn<(id: number) => void>();
    fireEvent.pointerDown(node, { clientX: 20, clientY: 35, pointerId: 1 });
    expect(node.dataset.dragging).toBe("true");
    expect(node.dataset.start).toBe(JSON.stringify({ x: 10, y: 15 }));
    fireEvent.pointerMove(node, { clientX: 25, clientY: 45, pointerId: 1 });
    expect(node.dataset.delta).toBe(JSON.stringify({ x: 5, y: 10 }));
    fireEvent.pointerUp(node, { pointerId: 1 });
    expect(node.dataset.dragging).toBe("false");
  });

  it("useDragRect measures and handles a mounted draggable element", () => {
    mockResizeObserver();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 50, 60),
    );

    function Draggable() {
      const { ref, rect, dragging, onPointerDown } = useDragRect<HTMLDivElement>();

      return createElement("div", {
        ref,
        onPointerDown,
        "data-testid": "drag-rect",
        "data-width": rect?.size.x,
        "data-height": rect?.size.y,
        "data-dragging": dragging,
      });
    }

    const view = render(createElement(Draggable));
    const node = view.getByTestId("drag-rect");
    node.setPointerCapture = vi.fn<(id: number) => void>();
    expect(node.dataset.width).toBe("50");
    expect(node.dataset.height).toBe("60");
    fireEvent.pointerDown(node, { clientX: 10, clientY: 10, pointerId: 1 });
    expect(node.dataset.dragging).toBe("true");
  });
});
