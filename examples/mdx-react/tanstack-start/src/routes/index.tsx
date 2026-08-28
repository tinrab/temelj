import { IconChevronDown } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import { SourceContent } from "@temelj/mdx-react";
import { useState } from "react";
import { TextArea } from "react-aria-components";

import { KaTeXMath } from "~/components/KaTeXMath";
import { mdxRegistry } from "~/components/registry";
import { Button } from "~/components/ui/button";
import { Collapsible, CollapsibleContent } from "~/components/ui/collapsible";

import { mdxSyntax, staticMdxSource } from "../../../content";

export const Route = createFileRoute("/")({ component: StaticExampleRoute });

function StaticExampleRoute() {
  const [content, setContent] = useState(staticMdxSource);

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
          registry={mdxRegistry}
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
