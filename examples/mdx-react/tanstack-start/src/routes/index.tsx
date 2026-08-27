import { IconChevronDown } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import { SourceContent } from "@temelj/mdx-react";
import { useState } from "react";
import { TextArea } from "react-aria-components";

import { KaTeXMath } from "~/components/KaTeXMath";
import { mdxRegistry } from "~/components/registry";
import { Button } from "~/components/ui/button";
import { Collapsible, CollapsibleContent } from "~/components/ui/collapsible";
import { mdxSyntax } from "~/lib/mdx";

export const Route = createFileRoute("/")({ component: StaticExampleRoute });

function StaticExampleRoute() {
  const [content, setContent] = useState(`---
title: MDX rendering fixture
draft: false
tags:
  - markdown
  - react
---

# MDX rendering fixture

This page is a visual check for the syntax supported by \`@temelj/mdx\`. It mixes ordinary Markdown with the optional syntax enabled by this example.

## Text and links

Plain text can contain **strong emphasis**, *emphasis*, ~~deleted text~~, and \`inline code\`. It can link to [the MDN Markdown guide](https://developer.mozilla.org/en-US/docs/MDN/Writing_guidelines/Howto/Markdown_in_MDN "Markdown on MDN") or turn https://example.com into an autolink.

This line ends with an explicit break.\\
The next sentence should begin on a new line without starting a new paragraph.

> A block quote can contain **formatted text**.
>
> It can also contain more than one paragraph.

---

## Lists and tasks

- An unordered item
- A nested list
  - Child one
  - Child two
- [x] A completed task
- [ ] An open task

1. First ordered item
2. Second ordered item
   1. Nested ordered item

## Table

| Feature | Input | Expected result |
| :--- | :---: | ---: |
| Alignment | left | right |
| Inline code | \`const x = 1\` | preserved |
| Escaping | *literal asterisks* | visible |

## Image and references

![Vite logo](/logo.svg "A local SVG served by Vite")

This [reference link][reference] and its definition exercise association lookup.

[reference]: https://github.com/tinrab/ "GitHub"

## Footnotes

A short statement can carry a footnote.[^short] Reusing it should add another backreference.[^short]

[^short]: Footnotes may contain **formatted text** and links.

## Directives

An inline :status[directive]{state=ready} appears inside a paragraph.

::notice[Leaf directive]{severity=info}

:::callout[Container directive]{tone=warning}
The container has a paragraph, \`code\`, and a list.

- First child
- Second child
:::

## Math delimiters

Dollar math renders inline as $E = mc^2$. TeX delimiters work in the same document as \\(a^2 + b^2 = c^2\\).

Caller-defined KaTeX macros work too: $x \\in \\RR$.

$$ fourier-transform
\\hat{f}(\\xi) = \\int_{-\\infty}^{\\infty} f(x)e^{-2\\pi i x\\xi} \\, dx
$$

\\[
\\sum_{k=1}^{n} k = \\frac{n(n + 1)}{2}
\\]

Malformed math stays readable instead of breaking the page: $\\frac{$.

## Code blocks

\`\`\`c file=math.c
float Q_rsqrt( float number )
{
	long i;
	float x2, y;
	const float threehalfs = 1.5F;

	x2 = number * 0.5F;
	y  = number;
	i  = * ( long * ) &y;                       // evil floating point bit level hacking
	i  = 0x5f3759df - ( i >> 1 );               // what the fuck?
	y  = * ( float * ) &i;
	y  = y * ( threehalfs - ( x2 * y * y ) );   // 1st iteration
//	y  = y * ( threehalfs - ( x2 * y * y ) );   // 2nd iteration, this can be removed

	return y;
}
\`\`\`

    Indented code remains a code block too.

## HTML and executable MDX stay inert

Raw HTML is displayed safely instead of being injected: <mark>highlighted by authored HTML</mark>.

Expressions remain visible rather than being evaluated: {2 + 2}.

The component registry also contains an Alert:

<Alert title="Info" description="Info description" />

<DemoCard title="Caller component">
  JSX is parsed, but SourceContent does not execute it.
</DemoCard>

export const hiddenFromRenderedHtml = 42

The export above belongs to the document model but is omitted from rendered HTML.
`);

  return (
    <>
      <Collapsible className="data-open:bg-muted rounded-md">
        <Button slot="trigger" variant="ghost" className="w-full">
          Edit
          <IconChevronDown className="ml-auto group-data-panel-open/button:rotate-180" />
        </Button>
        <CollapsibleContent>
          <div className="flex flex-col items-start gap-2 p-2.5 pt-0 text-base">
            <TextArea
              aria-label="MDX source"
              className="w-full"
              onChange={(event) => setContent(event.currentTarget.value)}
              rows={26}
              value={content}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>

      <article className="typeset">
        <SourceContent
          components={mdxRegistry}
          math={KaTeXMath}
          source={content}
          syntax={mdxSyntax}
          diagnosticFallback={(diagnostics) => (
            <pre className="border-error text-error rounded border p-4 whitespace-pre-wrap">
              {diagnostics
                .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
                .join("\n")}
            </pre>
          )}
        />
      </article>
    </>
  );
}
