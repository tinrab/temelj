/* oxlint-disable vitest/require-mock-type-parameters */
import { vi, type Mock } from "vitest";

class MockMediaChangeEvent extends Event implements MediaQueryListEvent {
  readonly matches: boolean;
  readonly media: string;
  constructor(matches: boolean, media: string) {
    super("change");
    this.matches = matches;
    this.media = media;
  }
}

/** Controllable matchMedia result backed by native EventTarget dispatch. */
export class MockMediaQueryList extends EventTarget {
  readonly media: string;
  matches: boolean;
  constructor(media: string, matches: boolean) {
    super();
    this.media = media;
    this.matches = matches;
  }
  setMatches(matches: boolean): void {
    this.matches = matches;
    this.dispatchEvent(new MockMediaChangeEvent(matches, this.media));
  }
}

/** Installs controllable media query lists. */
export function mockMatchMedia(
  matchesFor: (query: string) => boolean,
): Map<string, MockMediaQueryList> {
  const lists = new Map<string, MockMediaQueryList>();
  vi.stubGlobal("matchMedia", (query: string) => {
    let list = lists.get(query);

    if (!list) {
      list = new MockMediaQueryList(query, matchesFor(query));
      lists.set(query, list);
    }

    return list;
  });

  return lists;
}

/** A ResizeObserver mock that emits complete entries through its actual callback. */
export class MockResizeObserver implements ResizeObserver {
  readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe: Mock<(target: Element, options?: ResizeObserverOptions) => void> = vi.fn();
  unobserve: Mock<(target: Element) => void> = vi.fn();
  disconnect: Mock<() => void> = vi.fn();
  emit(target: Element): ResizeObserverEntry {
    const contentRect = target.getBoundingClientRect();
    const size = [{ inlineSize: contentRect.width, blockSize: contentRect.height }];

    const entry: ResizeObserverEntry = {
      target,
      contentRect,
      borderBoxSize: size,
      contentBoxSize: size,
      devicePixelContentBoxSize: size,
    };

    this.callback([entry], this);

    return entry;
  }
}

/** Installs ResizeObserver mocks and returns the instances created by hooks. */
export function mockResizeObserver(): MockResizeObserver[] {
  const instances: MockResizeObserver[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class extends MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        super(callback);
        instances.push(this);
      }
    },
  );

  return instances;
}
