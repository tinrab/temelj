import { formatHtml, htmlText, MdxStream, previewDocument, streamBlockEvents } from "@temelj/mdx";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import React from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { afterEach, expect, expectTypeOf, it, vi } from "vitest";

import {
  defineMdxRegistry,
  MdxBlockStore,
  MdxStreamStore,
  useMdxBlockStatus,
  StreamContent,
  StreamSourceContent,
  useMdxStream,
  type MdxStreamStoreOptions,
  type MdxStreamView,
} from "./mod.ts";

afterEach(cleanup);

it("appends, edits, completes and explicitly resets with stable methods", () => {
  const { result, rerender } = renderHook(
    (options: MdxStreamStoreOptions) => useMdxStream(options),
    {
      initialProps: { source: "# First" },
    },
  );

  const methods = [
    result.current.append,
    result.current.edit,
    result.current.complete,
    result.current.reset,
  ];

  expectTypeOf(result.current.view).toEqualTypeOf<MdxStreamView>();
  void act(() => result.current.append("\n\nSecond"));
  void act(() => result.current.edit({ start: 2, end: 7, text: "Edited" }));
  void act(() => result.current.complete());
  expect(result.current.view.kind).toBe("complete");
  expect(text(result.current.view)).toBe("Edited\nSecond");
  const completed = result.current.view;
  void act(() => result.current.complete());
  expect(result.current.view).toBe(completed);
  expect(() => result.current.append("more")).toThrow("completed MdxStream");
  rerender({ source: "Ignored after initialization" });
  expect(result.current.view).toBe(completed);
  act(() => result.current.reset());
  expect(result.current.view.generation).toBe(1);
  expect(text(result.current.view)).toBe("");
  expect([
    result.current.append,
    result.current.edit,
    result.current.complete,
    result.current.reset,
  ]).toEqual(methods);
});

it("can repair unsuccessful completion and applies limits", () => {
  const { result } = renderHook(() => useMdxStream({ source: "<Alert" }));
  void act(() => result.current.complete());
  expect(result.current.view).toMatchObject({
    kind: "failed",
    diagnostics: [{ code: "mdx.jsx.invalid" }],
  });
  void act(() => result.current.append(" />"));
  void act(() => result.current.complete());
  expect(result.current.view.kind).toBe("complete");
  act(() => result.current.reset({ limits: { maximumSourceLength: 3 } }));
  void act(() => result.current.append("long"));
  expect(result.current.view).toMatchObject({ kind: "streaming", limit: "maximumSourceLength" });
  void act(() => result.current.edit({ start: 0, end: 4, text: "ok" }));
  expect(result.current.view).toMatchObject({ kind: "streaming", limit: undefined });
});

it("preserves settled instances through appends and completion and clears them on reset", () => {
  const Heading = ({ children }: { children?: React.ReactNode }): React.ReactNode => {
    const [count, setCount] = React.useState(0);

    return (
      <h1>
        <button onClick={() => setCount(count + 1)}>
          {children} {count}
        </button>
      </h1>
    );
  };

  const registry = defineMdxRegistry({ html: { h1: Heading } });
  const hook = renderHook(() => useMdxStream({ source: "# Heading\n\nTail" }));
  const rendered = render(<StreamContent view={hook.result.current.view} registry={registry} />);
  const button = rendered.getByRole("button");
  act(() => button.click());
  void act(() => hook.result.current.append(".\n\nNext"));
  rendered.rerender(<StreamContent view={hook.result.current.view} registry={registry} />);
  expect(rendered.getByRole("button")).toBe(button);
  void act(() => hook.result.current.complete());
  rendered.rerender(<StreamContent view={hook.result.current.view} registry={registry} />);
  expect(rendered.getByRole("button")).toBe(button);
  expect(button.textContent).toBe("Heading 1");
  act(() => hook.result.current.reset({ source: "# Heading" }));
  rendered.rerender(<StreamContent view={hook.result.current.view} registry={registry} />);
  expect(rendered.getByRole("button")).not.toBe(button);
  expect(rendered.getByRole("button").textContent).toBe("Heading 0");
});

it("does not restart for equivalent configuration objects", () => {
  const Heading = vi.fn<({ children }: { children?: React.ReactNode }) => React.ReactNode>(
    ({ children }) => <h1>{children}</h1>,
  );

  const registry = defineMdxRegistry({ html: { h1: Heading } });

  const content = (source: string) => (
    <StreamSourceContent
      source={source}
      status="streaming"
      syntax={{ math: "auto", directives: false }}
      registry={registry}
    />
  );

  const { rerender } = render(content("# Settled\n\nTail"));
  rerender(content("# Settled\n\nTail."));
  expect(Heading).toHaveBeenCalledTimes(1);
});

it("hydrates deterministically and tolerates StrictMode remounts", async () => {
  function App(): React.ReactNode {
    const stream = useMdxStream({ source: "# Server\n\nText" });

    return <StreamContent view={stream.view} />;
  }

  const markup = renderToString(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );

  const container = document.createElement("div");
  container.innerHTML = markup;
  document.body.append(container);
  const errors = vi.fn<() => void>();

  const root = hydrateRoot(
    container,
    <React.StrictMode>
      <App />
    </React.StrictMode>,
    { onRecoverableError: errors },
  );

  await act(async () => {
    await Promise.resolve();
  });
  expect(errors).not.toHaveBeenCalled();
  expect(container.innerHTML).toBe(markup);
  act(() => root.unmount());
  container.remove();
});

it("renders every Markdown prefix with HTML parity and safe URLs", () => {
  const source =
    "# Answer\n\n**Bold** and [link](https://example.com).\n\n> Quote with _emphasis_\n\n- One\n- Two\n\n```ts\nconst x = 1;\n```\n\n**[bad](javascript:alert(1))**";

  const stream = new MdxStream();

  for (const character of source) {
    const snapshot = stream.append(character);

    const view: MdxStreamView = {
      kind: "streaming",
      generation: 0,
      preview: snapshot,
      diagnostics: snapshot.diagnostics,
      limit: snapshot.limit,
    };

    const html = formatHtml(previewDocument(snapshot));
    const react = renderToStaticMarkup(<StreamContent view={view} />);
    expect(normalize(react)).toEqual(normalize(html));
    expect(html).not.toContain('href="javascript:');
  }
});

it("consumes a transport, batching publishes and completing at EOF", async () => {
  const store = new MdxStreamStore({ schedule: (flush) => setTimeout(flush, 0) });
  const listener = vi.fn<() => void>();
  store.subscribe(listener);

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();

      for (const chunk of ["# Ti", "tle\n\n", "Body ", "\u00e9", "nd"]) {
        controller.enqueue(encoder.encode(chunk));
      }

      controller.close();
    },
  });

  const completion = await store.consume(new Response(body));

  expect(completion.kind).toBe("ok");
  expect(text(store.getSnapshot())).toBe("Title\nBody \u00e9nd");
  // One batched append and one completion.
  expect(listener).toHaveBeenCalledTimes(2);
});

it("leaves the preview open when consumption is aborted", async () => {
  const store = new MdxStreamStore({ schedule: (flush) => flush() });
  const controller = new AbortController();

  async function* chunks(): AsyncGenerator<string> {
    yield "Partial ";
    controller.abort(new Error("stopped"));
    yield "ignored";
  }

  await expect(store.consume(chunks(), { signal: controller.signal })).rejects.toThrow("stopped");
  expect(store.getSnapshot().kind).toBe("streaming");
  expect(text(store.getSnapshot())).toBe("Partial ");
});

it("does not re-render settled blocks when the tail grows", () => {
  const Heading = vi.fn<({ children }: { children?: React.ReactNode }) => React.ReactNode>(
    ({ children }) => <h1>{children}</h1>,
  );

  const registry = defineMdxRegistry({ html: { h1: Heading } });
  const hook = renderHook(() => useMdxStream({ source: "# Settled\n\nTail" }));

  const view = (): React.ReactNode => (
    <StreamContent registry={registry} view={hook.result.current.view} />
  );

  const rendered = render(view());

  for (const chunk of [" grows", " and", " grows."]) {
    void act(() => hook.result.current.append(chunk));
    rendered.rerender(view());
  }

  expect(Heading).toHaveBeenCalledTimes(1);
});

it("reports the open tail block as pending", () => {
  const Paragraph = ({ children }: { children?: React.ReactNode }): React.ReactNode => (
    <p data-status={useMdxBlockStatus()}>{children}</p>
  );

  const registry = defineMdxRegistry({ html: { p: Paragraph } });

  const { container, rerender } = render(
    <StreamSourceContent registry={registry} source={"First\n\nSecond"} status="streaming" />,
  );

  expect([...container.querySelectorAll("p")].map((node) => node.dataset.status)).toEqual([
    "complete",
    "pending",
  ]);

  rerender(
    <StreamSourceContent registry={registry} source={"First\n\nSecond"} status="complete" />,
  );

  expect([...container.querySelectorAll("p")].map((node) => node.dataset.status)).toEqual([
    "complete",
    "complete",
  ]);
});

/** The rendered text of a view. */
function text(view: MdxStreamView): string {
  return htmlText(view.kind === "complete" ? view.html : previewDocument(view.preview));
}

function normalize(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;

  const walk = (node: Node): void => {
    // Copy the live collection before removing whitespace nodes.
    for (const child of Array.from(node.childNodes)) {
      if (
        child.nodeType === Node.TEXT_NODE &&
        /^\s*\n\s*$/u.test(child.textContent ?? "") &&
        node.nodeName !== "PRE" &&
        node.nodeName !== "CODE"
      ) {
        child.remove();
      } else {
        walk(child);
      }
    }
  };

  walk(template.content);

  return template.innerHTML;
}

it("renders server block events without parsing on the client", async () => {
  const source = "# Title\n\nSome **bold** text[^a].\n\n- one\n- two\n\n[^a]: Note\n";

  async function* chunks(): AsyncGenerator<string> {
    for (let offset = 0; offset < source.length; offset += 4) {
      yield source.slice(offset, offset + 4);
    }
  }

  const lines: string[] = [];

  for await (const event of streamBlockEvents(chunks())) {
    lines.push(`${JSON.stringify(event)}\n`);
  }

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();

      for (const line of lines) {
        controller.enqueue(encoder.encode(line));
      }

      controller.close();
    },
  });

  const store = new MdxBlockStore({ schedule: (flush) => flush() });
  const view = await store.consume(new Response(body));

  expect(view.kind).toBe("complete");
  expect(normalize(renderToStaticMarkup(<StreamContent view={view} />))).toBe(
    normalize(renderToStaticMarkup(<StreamSourceContent source={source} status="complete" />)),
  );
});

it("reuses elements of unchanged nodes inside the open block", () => {
  const renders = vi.fn<() => void>();

  const Strong = ({ children }: { children?: React.ReactNode }): React.ReactNode => {
    renders();

    return <strong>{children}</strong>;
  };

  const registry = defineMdxRegistry({ html: { strong: Strong } });
  const { result } = renderHook(() => useMdxStream());
  const rendered = render(<StreamContent registry={registry} view={result.current.view} />);

  for (const chunk of ["**first**\n", "more ", "words\n", "and ", "more"]) {
    void act(() => result.current.append(chunk));
    rendered.rerender(<StreamContent registry={registry} view={result.current.view} />);
  }

  // Once its line ends, the first line keeps its node, so later appends reuse its element.
  expect(renders).toHaveBeenCalledTimes(2);
  expect(rendered.container.textContent).toBe("first\nmore words\nand more");
});
