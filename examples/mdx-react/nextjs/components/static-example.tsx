"use client";

import { IconChevronDown } from "@tabler/icons-react";
import { SourceContent } from "@temelj/mdx-react";
import { useState } from "react";

import { mdxRegistry } from "@/components/mdx-registry";
import { buttonVariants } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";

import { mdxSyntax } from "../../content.ts";

export interface StaticExampleProps {
  readonly initialSource: string;
}

export function StaticExample({ initialSource }: StaticExampleProps): React.ReactNode {
  const [content, setContent] = useState(initialSource);

  return (
    <>
      <Collapsible className="data-expanded:bg-muted rounded-md">
        <CollapsibleTrigger className={buttonVariants({ variant: "ghost", className: "w-full" })}>
          Edit
          <IconChevronDown
            className="ml-auto group-data-expanded/button:rotate-180"
            data-icon="inline-end"
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-col items-start gap-2 p-2.5 pt-0 text-base">
            <Textarea
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
          fallback={(diagnostics) => (
            <pre className="border-destructive text-destructive rounded border p-4 whitespace-pre-wrap">
              {diagnostics
                .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
                .join("\n")}
            </pre>
          )}
          source={content}
          syntax={mdxSyntax}
        />
      </article>
    </>
  );
}
