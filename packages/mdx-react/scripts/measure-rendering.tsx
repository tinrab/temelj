import { MdxStream } from "@temelj/mdx";
import { performance } from "node:perf_hooks";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { StreamContent } from "../src/mod.ts";

const source = "# Answer\n\n" + "Paragraph with **bold** and [link](/docs).\n\n".repeat(200);

const stream = new MdxStream();

let renderMs = 0;

let renders = 0;

for (let offset = 0; offset < source.length; offset += 32) {
  const snapshot = stream.append(source.slice(offset, offset + 32));
  const started = performance.now();
  renderToStaticMarkup(<StreamContent view={{ kind: "streaming", generation: 0, snapshot }} />);
  renderMs += performance.now() - started;
  renders++;
}

console.log(
  JSON.stringify({
    mode: "React SSR per snapshot, without client memoization",
    renders,
    renderMs,
    meanRenderMs: renderMs / renders,
  }),
);
