import type {
  AsynchronousSyntaxHighlighter,
  SynchronousSyntaxHighlighter,
  SyntaxHighlighter,
} from "@temelj/mdx/plugin";
import type React from "react";

import { HtmlCodeBlockNode, HtmlElementNode, HtmlTextNode } from "@temelj/mdx";
import { render, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import type { MdxRegistry } from "./registry.ts";
import type { MdxComponentProps } from "./types.ts";

import { HighlightedCode } from "./highlighted-code.tsx";
import { defineMdxRegistry } from "./registry.ts";

test("shows readable code without an external service", () => {
  const code = render(<HighlightedCode code="const x = 1" language="ts" />);
  expect(code.container.textContent).toBe("const x = 1\n");
  expect(code.container.querySelector("code")?.className).toBe("language-ts");
});

test("does not highlight code without a language", () => {
  const highlight = vi.fn<SynchronousSyntaxHighlighter["highlight"]>();
  const code = render(
    <HighlightedCode
      code="plain"
      highlighter={{ highlight, kind: "synchronous" }}
      meta='{"lineNumbers":true}'
    />,
  );

  expect(highlight).not.toHaveBeenCalled();
  expect(code.container.querySelector("code")?.hasAttribute("class")).toBe(false);
  expect(code.container.querySelector("pre")?.hasAttribute("data-meta")).toBe(false);
});

test("does not send its fallback back through the semantic code block component", () => {
  let components: MdxRegistry | undefined;
  function CodeBlock({
    node,
    ...props
  }: React.HTMLAttributes<HTMLPreElement> & MdxComponentProps): React.ReactNode {
    return node instanceof HtmlCodeBlockNode ? (
      <HighlightedCode
        code={node.codeBlock.code}
        components={components}
        language={node.codeBlock.language}
      />
    ) : (
      <pre {...props} />
    );
  }
  components = defineMdxRegistry({ html: { pre: CodeBlock } });

  const code = render(
    <HighlightedCode code="const value = 1" components={components} language="ts" />,
  );

  expect(code.container.querySelector("pre")?.textContent).toBe("const value = 1\n");
});

test("keeps the highlighted block mounted while its next update is pending", async () => {
  const next = Promise.withResolvers<HtmlElementNode>();
  const highlighter = {
    highlight: vi.fn<AsynchronousSyntaxHighlighter["highlight"]>(({ code }) =>
      code === "first"
        ? Promise.resolve(
            new HtmlElementNode("pre", { "data-code": code }, [new HtmlTextNode(code)]),
          )
        : next.promise,
    ),
    kind: "asynchronous",
  } satisfies SyntaxHighlighter;
  const code = render(<HighlightedCode code="first" highlighter={highlighter} language="ts" />);
  await waitFor(() => {
    expect(code.container.querySelector("[data-code]")?.textContent).toBe("first");
  });

  code.rerender(<HighlightedCode code="second" highlighter={highlighter} language="ts" />);

  expect(code.container.querySelector("[data-code]")?.textContent).toBe("first");
  next.resolve(new HtmlElementNode("pre", { "data-code": "second" }, [new HtmlTextNode("second")]));
  await waitFor(() => {
    expect(code.container.querySelector("[data-code]")?.textContent).toBe("second");
  });
});

test("passes typed metadata and ignores stale asynchronous results", async () => {
  const first = Promise.withResolvers<HtmlElementNode>();
  const highlighter = {
    highlight: vi.fn<AsynchronousSyntaxHighlighter["highlight"]>(({ code, metadata }) =>
      code === "first"
        ? first.promise
        : Promise.resolve(
            new HtmlElementNode("pre", { "data-code": code }, [
              new HtmlTextNode(metadata.fileName ?? ""),
            ]),
          ),
    ),
    kind: "asynchronous",
  } satisfies SyntaxHighlighter;
  const code = render(
    <HighlightedCode
      code="first"
      highlighter={highlighter}
      language="ts"
      meta='{"fileName":"first.ts"}'
    />,
  );

  code.rerender(
    <HighlightedCode
      code="second"
      highlighter={highlighter}
      language="ts"
      meta='{"fileName":"second.ts"}'
    />,
  );
  await waitFor(() => {
    expect(code.container.querySelector("[data-code]")?.getAttribute("data-code")).toBe("second");
  });
  first.resolve(
    new HtmlElementNode("pre", { "data-code": "first" }, [new HtmlTextNode("first.ts")]),
  );
  await Promise.resolve();

  expect(code.container.querySelector("[data-code]")?.getAttribute("data-code")).toBe("second");
  expect(code.container.textContent).toBe("second.ts");
});
