import type { SyntaxHighlighter } from "@temelj/mdx/plugin";

import { HtmlElementNode, HtmlFragmentNode, HtmlTextNode, Processor } from "@temelj/mdx";
// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import type { MdxRegistry } from "./registry.ts";
import type {
  CompiledContentComponent,
  MathComponentProps,
  MdxCodeBlockComponentProps,
  MdxComponentProps,
  PendingMdxMarkdownProps,
  PendingMdxJsxProps,
} from "./types.ts";

import {
  CompiledContent,
  compileTrustedMdx,
  defineMdxRegistry,
  HighlightedCode,
  HtmlNodeContent,
  SourceContent,
  StreamingSourceContent,
} from "./mod.ts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MDX React content", () => {
  const mathProcessor = new Processor({ syntax: { math: "auto" } });
  const Math = ({ meta, source, style }: MathComponentProps): React.ReactNode => (
    <span data-meta={meta} data-source={source} data-style={style}>
      {source}
    </span>
  );

  it("renders source without evaluating expressions or JSX", () => {
    render(<SourceContent source="<Widget>{value}</Widget>" />);
    expect(screen.getByText("<Widget>{value}</Widget>")).toBeDefined();
  });

  it("renders static source through react-dom/server without hooks", () => {
    expect(renderToStaticMarkup(<SourceContent source="# Server" />)).toBe("<h1>Server</h1>");
  });

  it("passes serializable completed node metadata to registered components", () => {
    const Alert = ({ node }: MdxComponentProps): React.ReactNode => (
      <aside data-node={JSON.stringify(node)} />
    );
    const { container } = render(
      <SourceContent
        registry={defineMdxRegistry({ jsx: { Alert: { component: Alert } } })}
        source={'<Alert title="Info" />'}
      />,
    );

    const encoded = container.querySelector("aside")?.getAttribute("data-node");
    expect(encoded).toBeDefined();
    const received: unknown = JSON.parse(encoded ?? "null");
    expect(received).toEqual({
      kind: "jsxFlowElement",
      name: "Alert",
      attributes: { title: "Info" },
      source: { name: "source.mdx", start: 0, end: 22 },
    });
    expect(structuredClone(received)).toEqual(received);
  });

  it("renders registered JSX components with static properties", () => {
    const Alert = ({
      description,
      node,
      title,
    }: MdxComponentProps & {
      readonly description?: string;
      readonly title?: string;
    }): React.ReactNode => (
      <aside data-node-kind={node?.kind}>
        <strong>{title}</strong>
        <p>{description}</p>
      </aside>
    );

    render(
      <SourceContent
        registry={defineMdxRegistry({ jsx: { Alert: { component: Alert } } })}
        source={'<Alert title="Info" description="Info description" />'}
      />,
    );

    expect(screen.getByText("Info")).toBeDefined();
    expect(screen.getByText("Info description")).toBeDefined();
    expect(document.querySelector("aside")?.getAttribute("data-node-kind")).toBe("jsxFlowElement");
  });

  it("keeps executable JSX properties inert for registered components", () => {
    const Alert = vi.fn<() => React.ReactNode>(() => <aside>executed</aside>);

    render(
      <SourceContent
        registry={defineMdxRegistry({ jsx: { Alert: { component: Alert } } })}
        source="<Alert title={getTitle()} />"
      />,
    );

    expect(Alert).not.toHaveBeenCalled();
    expect(screen.getByText("<Alert title={getTitle()} />")).toBeDefined();
  });

  it("renders committed pending JSX with completed props and Markdown children", () => {
    const Note = ({ title }: { readonly title: string }): React.ReactNode => <aside>{title}</aside>;
    const Pending = ({ children, title }: PendingMdxJsxProps<typeof Note>): React.ReactNode => (
      <section aria-label="pending note">
        <strong>{title}</strong>
        {children}
      </section>
    );
    const registry = defineMdxRegistry({
      jsx: { Note: { component: Note, pending: Pending } },
    });

    const { rerender } = render(
      <StreamingSourceContent
        registry={registry}
        math={Math}
        source={'<Note title="Inf'}
        status="streaming"
        syntax={{ math: "auto" }}
      />,
    );
    const pending = screen.getByLabelText("pending note");
    expect(pending.textContent).toBe("");

    rerender(
      <StreamingSourceContent
        registry={registry}
        math={Math}
        source={'<Note title="Info">Some **valid** content and $x$'}
        status="streaming"
        syntax={{ math: "auto" }}
      />,
    );
    expect(screen.getByLabelText("pending note")).toBe(pending);
    expect(screen.getByText("Info")).toBeDefined();
    expect(screen.getByText("valid").tagName).toBe("STRONG");
    expect(document.querySelector('[data-source="x"][data-style="inline"]')).not.toBeNull();
  });

  it("uses global pending only for exact registered JSX names", () => {
    const Alert = (): React.ReactNode => <aside>ready</aside>;
    const PendingMarkdown = vi.fn<(props: PendingMdxMarkdownProps) => React.ReactNode>(
      ({ children, node }: PendingMdxMarkdownProps): React.ReactNode => (
        <span data-pending-kind={node.kind}>{children}</span>
      ),
    );
    const registry = defineMdxRegistry({
      jsx: { Alert: { component: Alert } },
      pending: {
        jsx: ({ name }) => <span>waiting {name}</span>,
        markdown: PendingMarkdown,
      },
    });
    const { rerender } = render(
      <StreamingSourceContent registry={registry} source="<Ale" status="streaming" />,
    );
    expect(document.body.textContent).toBe("");

    rerender(<StreamingSourceContent registry={registry} source="<Alert " status="streaming" />);
    expect(screen.getByText("waiting Alert")).toBeDefined();

    const unresolvedSource = "The [manual][docs] is final.\n\n";
    rerender(
      <StreamingSourceContent registry={registry} source={unresolvedSource} status="streaming" />,
    );
    expect(screen.getByText("[manual][docs]").getAttribute("data-pending-kind")).toBe(
      "unresolvedLinkReference",
    );
    expect(PendingMarkdown.mock.lastCall?.[0].node).toMatchObject({
      authored: "[manual][docs]",
      identifier: "DOCS",
      referenceKind: "full",
    });

    rerender(
      <StreamingSourceContent
        registry={registry}
        source={`${unresolvedSource}[docs]: https://rabzelj.com\n`}
        status="streaming"
      />,
    );
    expect(screen.getByRole("link", { name: "manual" }).getAttribute("href")).toBe(
      "https://rabzelj.com",
    );
  });

  it.each([
    '<Alert title="x" bad={foo',
    "<Alert {...props",
    "<Alert children",
    "<Alert key=",
    '<Alert node="unfinished',
    "<Alert ref={value",
  ])("keeps pending JSX inert for unsafe unfinished attributes in %s", (source) => {
    const Alert = (): React.ReactNode => <aside>ready</aside>;
    const Pending = vi.fn<() => React.ReactNode>(() => <span>waiting</span>);

    render(
      <StreamingSourceContent
        registry={defineMdxRegistry({ jsx: { Alert: { component: Alert, pending: Pending } } })}
        source={source}
        status="streaming"
      />,
    );

    expect(Pending).not.toHaveBeenCalled();
    expect(document.body.textContent).toBe("");
  });

  it("infers optional pending props without accepting raw registries", () => {
    const Note = ({ title }: { readonly title: string }): React.ReactNode => title;
    const registry = defineMdxRegistry({
      html: { Note: "aside" },
      jsx: {
        Note: { component: Note },
        QuietNote: { component: Note, pending: null },
        LoadingNote: {
          component: Note,
          pending: ({ title }) => {
            expectTypeOf(title).toEqualTypeOf<string | undefined>();
            return title;
          },
        },
      },
    });
    expectTypeOf(registry).toMatchTypeOf<MdxRegistry>();

    const acceptRegistry = (_registry: MdxRegistry): void => {};
    // @ts-expect-error A registry contains normalized HTML and JSX records.
    acceptRegistry({ html: { Note } });

    defineMdxRegistry({
      jsx: {
        Invalid: {
          component: Note,
          // @ts-expect-error A required component prop is optional while JSX is incomplete.
          pending: ({ title }: { readonly title: string }) => title,
        },
      },
    });
  });

  it("renders keyed stream blocks", () => {
    const source = "# One\n\nTwo";
    const { rerender } = render(<StreamingSourceContent source={source} status="streaming" />);
    const heading = screen.getByRole("heading", { name: /One/u });
    const paragraph = screen.getByText("Two");
    rerender(<StreamingSourceContent source={`Intro\n\n${source}`} status="streaming" />);
    expect(screen.getByRole("heading", { name: /One/u })).toBe(heading);
    expect(screen.getByText("Two")).toBe(paragraph);
    rerender(<StreamingSourceContent source={`Intro\n\n${source}`} status="complete" />);
    expect(document.body.textContent).toContain("Two");

    const footnotes = "One[^note].\n\nTwo[^note].\n\n[^note]: Shared note.\n";
    rerender(<StreamingSourceContent source={footnotes} status="streaming" />);
    const section = document.querySelector("[data-footnotes]");
    expect(section).not.toBeNull();
    expect(document.querySelectorAll("[data-footnotes]")).toHaveLength(1);
    expect(document.querySelectorAll("#user-content-fnref-note")).toHaveLength(1);
    expect(document.querySelectorAll("#user-content-fnref-note-2")).toHaveLength(1);

    rerender(<StreamingSourceContent source={`${footnotes}\nAfter.`} status="streaming" />);
    expect(document.querySelector("[data-footnotes]")).toBe(section);

    const PendingMarkdown = vi.fn<(props: PendingMdxMarkdownProps) => React.ReactNode>(
      ({ children, node }: PendingMdxMarkdownProps): React.ReactNode =>
        node.kind === "footnoteReference" || node.kind === "footnoteSection" ? null : children,
    );
    const registry = defineMdxRegistry({ pending: { markdown: PendingMarkdown } });
    rerender(
      <StreamingSourceContent
        registry={registry}
        source={`${footnotes}\nAfter.`}
        status="streaming"
      />,
    );
    expect(document.querySelector("[data-footnotes]")).toBeNull();
    expect(document.querySelector("[data-footnote-ref]")).toBeNull();
    expect(PendingMarkdown.mock.calls.map(([props]) => props.node.kind)).toEqual([
      "footnoteReference",
      "footnoteReference",
      "footnoteSection",
    ]);
    expect(PendingMarkdown.mock.calls[0]?.[0].node).toMatchObject({
      authored: "[^note]",
      identifier: "NOTE",
      occurrence: 1,
      ordinal: 1,
    });

    PendingMarkdown.mockClear();
    rerender(
      <StreamingSourceContent
        registry={registry}
        source={`${footnotes}\nAfter.`}
        status="complete"
      />,
    );
    expect(document.querySelector("[data-footnotes]")).not.toBeNull();
    expect(document.querySelectorAll("[data-footnote-ref]")).toHaveLength(2);
    PendingMarkdown.mockClear();
    rerender(
      <StreamingSourceContent
        registry={registry}
        source={`${footnotes}\nAfter.`}
        status="complete"
      />,
    );
    expect(PendingMarkdown).not.toHaveBeenCalled();
  });

  it("preserves block DOM when the completed pipeline takes over", () => {
    const source = "# One\n\nTwo";
    const { rerender } = render(<StreamingSourceContent source={source} status="streaming" />);
    const heading = screen.getByRole("heading", { name: /One/u });
    const paragraph = screen.getByText("Two");

    rerender(<StreamingSourceContent source={source} status="complete" />);

    expect(screen.getByRole("heading", { name: /One/u })).toBe(heading);
    expect(screen.getByText("Two")).toBe(paragraph);
  });

  it("preserves and highlights code-block semantics while streaming", async () => {
    const CodeBlock = ({ node }: MdxComponentProps) => (
      <pre
        data-code={node.kind === "element" ? node.codeBlock?.code : undefined}
        data-language={node.kind === "element" ? node.codeBlock?.language : undefined}
      />
    );

    const { container } = render(
      <StreamingSourceContent
        registry={defineMdxRegistry({ html: { pre: CodeBlock } })}
        source={"```ts\nconst answer = 42;\n```\n\nMore"}
        status="streaming"
      />,
    );

    expect(container.querySelector("pre")?.getAttribute("data-code")).toBe("const answer = 42;");
    expect(container.querySelector("pre")?.getAttribute("data-language")).toBe("ts");

    const highlighter = {
      highlight: ({ code, metadata }) =>
        new HtmlElementNode(
          "pre",
          { "data-file-name": metadata.fileName ?? "", "data-highlighted": "" },
          [new HtmlTextNode(code)],
        ),
      kind: "synchronous",
    } satisfies SyntaxHighlighter;
    const PendingMarkdown = ({ children, node }: PendingMdxMarkdownProps): React.ReactNode =>
      node.kind === "pendingFencedCode" ? (
        <HighlightedCode
          code={node.value}
          highlighter={highlighter}
          language={node.language}
          meta={node.meta}
        />
      ) : (
        children
      );
    const pending = render(
      <StreamingSourceContent
        registry={defineMdxRegistry({ pending: { markdown: PendingMarkdown } })}
        source={'```ts {"fileName":"stream.ts"}\nconst streaming = true;'}
        status="streaming"
      />,
    );

    await waitFor(() => {
      expect(pending.container.querySelector("[data-highlighted]")?.textContent).toBe(
        "const streaming = true;",
      );
      expect(
        pending.container.querySelector("[data-highlighted]")?.getAttribute("data-file-name"),
      ).toBe("stream.ts");
    });
  });

  it("keeps a highlighted code block mounted while its fence settles", async () => {
    const highlighter = {
      highlight: ({ code }) =>
        new HtmlElementNode("pre", { "data-highlighted": "" }, [new HtmlTextNode(code)]),
      kind: "synchronous",
    } satisfies SyntaxHighlighter;
    const CodeBlock = ({ code, language, status }: MdxCodeBlockComponentProps) => (
      <div data-code-status={status}>
        <HighlightedCode code={code} highlighter={highlighter} language={language} />
      </div>
    );
    const registry = defineMdxRegistry({ markdown: { codeBlock: CodeBlock } });
    const view = render(
      <StreamingSourceContent
        registry={registry}
        source={"```ts\nconst first = 1;"}
        status="streaming"
      />,
    );
    const original = view.container.querySelector("[data-highlighted]");
    expect(original?.textContent).toBe("const first = 1;");

    view.rerender(
      <StreamingSourceContent
        registry={registry}
        source={"```ts\nconst first = 1;\nconst second = 2;"}
        status="streaming"
      />,
    );
    await waitFor(() => {
      expect(view.container.querySelector("[data-highlighted]")?.textContent).toContain(
        "const second = 2;",
      );
    });
    expect(view.container.querySelector("[data-highlighted]")).toBe(original);

    view.rerender(
      <StreamingSourceContent
        registry={registry}
        source={"```ts\nconst first = 1;\nconst second = 2;\n```"}
        status="complete"
      />,
    );
    await waitFor(() => {
      expect(
        view.container.querySelector("[data-code-status]")?.getAttribute("data-code-status"),
      ).toBe("complete");
    });
    expect(view.container.querySelector("[data-highlighted]")).toBe(original);
  });

  it("keeps the last valid blocks while a streamed construct is incomplete", () => {
    const { rerender } = render(<StreamingSourceContent source={"# One\n\n"} status="streaming" />);
    const heading = screen.getByRole("heading", { name: /One/u });

    rerender(
      <StreamingSourceContent
        diagnosticFallback="Invalid stream"
        source={'# One\n\n<Alert title="Stream complete" '}
        status="streaming"
      />,
    );

    expect(screen.getByRole("heading", { name: /One/u })).toBeDefined();
    expect(screen.queryByText("Invalid stream")).toBeNull();

    rerender(
      <StreamingSourceContent
        source={'# One\n\n<Alert title="Stream complete" description="The stream settled." />\n'}
        status="complete"
      />,
    );

    expect(screen.getByRole("heading", { name: /One/u })).toBe(heading);
  });

  it("reports incomplete syntax when the stream is complete", () => {
    render(
      <StreamingSourceContent
        diagnosticFallback="Invalid stream"
        source={'# One\n\n<Alert title="Stream complete" '}
        status="complete"
      />,
    );

    expect(screen.getByText("Invalid stream")).toBeDefined();
  });

  it("renders inline and display math through one semantic component", () => {
    render(
      <SourceContent
        math={Math}
        source={"$x$ and \\(y\\)\n\n$$ equation\nz\n$$"}
        syntax={{ math: "auto" }}
      />,
    );

    expect(document.querySelector('[data-source="x"]')?.getAttribute("data-style")).toBe("inline");
    expect(document.querySelector('[data-source="y"]')?.getAttribute("data-style")).toBe("inline");
    expect(document.querySelector('[data-source="z"]')?.getAttribute("data-style")).toBe("display");
    expect(document.querySelector('[data-source="z"]')?.getAttribute("data-meta")).toBe("equation");
  });

  it("does not reinterpret authored raw HTML as semantic math", () => {
    const { container } = render(
      <SourceContent
        math={Math}
        source={'<code class="math-inline">authored</code>'}
        syntax={{ math: "auto" }}
      />,
    );

    expect(container.querySelector("[data-source]")).toBeNull();
    expect(container.textContent).toContain('<code class="math-inline">authored</code>');
  });

  it("uses the semantic math component for streaming and direct HTML nodes", () => {
    const source = "\\(stream\\)";
    const { container } = render(
      <StreamingSourceContent
        math={Math}
        source={source}
        status="complete"
        syntax={{ math: "auto" }}
      />,
    );
    expect(container.querySelector('[data-source="stream"]')).not.toBeNull();

    const outcome = mathProcessor.processSync("$direct$\n");
    if (outcome.kind !== "processed") {
      throw new Error(`Expected processed outcome, received ${outcome.kind}`);
    }
    const html = outcome.value.html;
    render(<HtmlNodeContent math={Math} node={html} />);
    expect(document.querySelector('[data-source="direct"]')).not.toBeNull();
  });

  it("renders committed math during streaming while unfinished math stays inert", () => {
    const PendingMarkdown = vi.fn<(props: PendingMdxMarkdownProps) => React.ReactNode>(
      ({ children }: PendingMdxMarkdownProps): React.ReactNode => children,
    );
    const registry = defineMdxRegistry({ pending: { markdown: PendingMarkdown } });
    const { rerender } = render(
      <StreamingSourceContent
        registry={registry}
        math={Math}
        source={"$$\ny\n$$\n\n$x$ and $open"}
        status="streaming"
        syntax={{ math: "auto" }}
      />,
    );

    expect(document.querySelector('[data-source="y"][data-style="display"]')).not.toBeNull();
    const committed = document.querySelector('[data-source="x"][data-style="inline"]');
    expect(committed).not.toBeNull();
    expect(document.querySelector('[data-source="open"]')).toBeNull();
    expect(document.body.textContent).toContain("$open");
    expect(PendingMarkdown).not.toHaveBeenCalled();

    rerender(
      <StreamingSourceContent
        registry={registry}
        math={Math}
        source={"$$\ny\n$$\n\n$x$ and $open$"}
        status="streaming"
        syntax={{ math: "auto" }}
      />,
    );

    expect(document.querySelector('[data-source="open"][data-style="inline"]')).not.toBeNull();
    expect(document.querySelector('[data-source="x"]')).toBe(committed);
  });

  it("keeps committed inline syntax before an unfinished suffix", () => {
    render(
      <StreamingSourceContent
        source={"**ready** and [docs](https://rabzelj.com), then `open"}
        status="streaming"
      />,
    );

    expect(screen.getByText("ready").tagName).toBe("STRONG");
    expect(screen.getByRole("link", { name: "docs" }).getAttribute("href")).toBe(
      "https://rabzelj.com",
    );
    expect(screen.getByText("open").tagName).toBe("CODE");
  });

  it("renders generated void elements without children", () => {
    const source = [
      "First line\\",
      "second line.",
      "",
      "![Vite](/vite.svg)",
      "",
      "---",
      "",
      "- [x] Done",
    ].join("\n");

    render(<SourceContent source={source} />);

    expect(document.querySelector("br")).not.toBeNull();
    expect(screen.getByRole("img", { name: "Vite" })).toBeDefined();
    expect(document.querySelector("hr")).not.toBeNull();
    expect(screen.getByRole("checkbox")).toBeDefined();
  });

  it("converts CSS strings and namespace-aware attributes to React props", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const node = new HtmlFragmentNode([
      new HtmlElementNode("span", {
        "aria-describedby": "description",
        "aria-label": "Example",
        "data-directive": "note",
        "data-directive-attributes": '[["tone","info"]]',
        "data-directive-kind": "container",
        "data-directive-label": "",
        "data-footnote-backref": "",
        "data-footnote-ref": "",
        "data-footnotes": "",
        style: "background-color: red; color: white",
      }),
      new HtmlElementNode("svg", { viewBox: "0 0 10 10" }, [
        new HtmlElementNode("path", { "stroke-linecap": "round", "stroke-width": 2 }),
      ]),
    ]);

    const { container } = render(<HtmlNodeContent node={node} />);

    const span = container.querySelector("span");
    expect(span?.style.backgroundColor).toBe("red");
    expect(span?.getAttribute("aria-describedby")).toBe("description");
    expect(span?.getAttribute("aria-label")).toBe("Example");
    expect(span?.getAttribute("data-directive")).toBe("note");
    expect(span?.getAttribute("data-directive-attributes")).toBe('[["tone","info"]]');
    expect(span?.getAttribute("data-directive-kind")).toBe("container");
    expect(span?.getAttribute("data-directive-label")).toBe("");
    expect(span?.getAttribute("data-footnote-backref")).toBe("");
    expect(span?.getAttribute("data-footnote-ref")).toBe("");
    expect(span?.getAttribute("data-footnotes")).toBe("");
    expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 10 10");
    expect(container.querySelector("path")?.getAttribute("stroke-linecap")).toBe("round");
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("renders tables without whitespace in table-only containers", () => {
    const source = ["| Name | Count |", "| - | -: |", "| Alpha | 1 |"].join("\n");

    render(<SourceContent source={source} />);

    for (const element of document.querySelectorAll("table, thead, tbody, tr")) {
      expect([...element.childNodes].every((child) => child.nodeType !== Node.TEXT_NODE)).toBe(
        true,
      );
    }
  });

  it("renders only explicitly supplied compiled components", () => {
    const Trusted = (): React.ReactNode => <strong>trusted</strong>;
    render(<CompiledContent module={{ default: Trusted }} />);
    expect(screen.getByText("trusted")).toBeDefined();
  });

  it("passes a semantic math component to compiled content", () => {
    const Trusted: CompiledContentComponent = ({ math }) =>
      math === undefined
        ? null
        : React.createElement(math, { source: "compiled", style: "display" });
    render(<CompiledContent module={{ default: Trusted }} math={Math} />);
    expect(document.querySelector('[data-source="compiled"]')).not.toBeNull();
  });

  it("compiles and evaluates trusted MDX with scope", async () => {
    const outcome = await compileTrustedMdx("# Hello {name}\n", {
      scope: { name: "Tin" },
    });

    expect(outcome.kind).toBe("compiled");
    if (outcome.kind !== "compiled") {
      return;
    }
    render(<CompiledContent module={outcome.module} />);
    expect(screen.getByRole("heading", { name: "Hello Tin" })).toBeDefined();
  });

  it("resolves trusted imports explicitly and preserves named exports", async () => {
    const outcome = await compileTrustedMdx(
      'import {answer} from "facts"\nexport const title = "Imported"\n\n# {answer}\n',
      {
        resolveImport(specifier) {
          return specifier === "facts" ? { answer: 42 } : {};
        },
      },
    );

    expect(outcome.kind).toBe("compiled");
    if (outcome.kind !== "compiled") {
      return;
    }
    expect(outcome.module.title).toBe("Imported");
    render(<CompiledContent module={outcome.module} />);
    expect(screen.getByRole("heading", { name: "42" })).toBeDefined();
  });

  it("does not evaluate imports without a resolver", async () => {
    const outcome = await compileTrustedMdx('import value from "remote"\n\n{value}\n');
    expect(outcome.kind).toBe("evaluationFailed");
    expect(outcome.diagnostics[0]?.code).toBe("mdx.evaluation.importResolver");
  });

  it("renders compiled footnotes with backlinks", async () => {
    const outcome = await compileTrustedMdx("A note[^one].\n\n[^one]: Footnote body.\n");
    expect(outcome.kind).toBe("compiled");
    if (outcome.kind !== "compiled") {
      return;
    }

    const { container } = render(<CompiledContent module={outcome.module} />);
    expect(container.querySelector("section[data-footnotes]")?.textContent).toContain(
      "Footnote body.",
    );
    expect(container.querySelector("[data-footnote-backref]")?.getAttribute("href")).toBe(
      "#user-content-fnref-one",
    );
  });

  it("routes compiled code blocks through the semantic registry", async () => {
    const outcome = await compileTrustedMdx("```ts showLineNumbers\nconst answer = 42;\n```\n");
    expect(outcome.kind).toBe("compiled");
    if (outcome.kind !== "compiled") {
      return;
    }
    const CodeBlock = ({ code, language, meta, status }: MdxCodeBlockComponentProps) => (
      <pre data-language={language} data-meta={meta} data-status={status}>
        {code}
      </pre>
    );
    render(
      <CompiledContent
        registry={defineMdxRegistry({ markdown: { codeBlock: CodeBlock } })}
        module={outcome.module}
      />,
    );
    expect(screen.getByText("const answer = 42;").getAttribute("data-language")).toBe("ts");
    expect(screen.getByText("const answer = 42;").getAttribute("data-meta")).toBe(
      "showLineNumbers",
    );
    expect(screen.getByText("const answer = 42;").getAttribute("data-status")).toBe("complete");
  });
});
