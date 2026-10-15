# MDX React examples

Open `/streaming` and press Start to stream a document. Press Start again to
abort and restart it. The speed slider adjusts playback from 0.25x to 4x,
including while the stream is running. Each example passes paced chunks to
`consume()` from `useMdxStream`, which batches updates per frame and completes
the document at EOF. `StreamContent` renders
the view. Navigating away aborts the request and leaves the preview open.

Next.js consumes a `fetch` response. TanStack Start consumes strings from a
streaming server function. Both show a CSS-only caret while streaming.

The Next.js example also has:

- `/server-streaming` parses on the server. The `/api/mdx-blocks` route runs
  `streamBlockEvents()` and sends block events as newline-delimited JSON;
  the page renders them with `useMdxBlocks()` and never parses in the browser.

From the repository root:

- Next.js: `pnpm --dir examples/mdx-react/nextjs dev --port 3100`.
- TanStack Start: `pnpm --dir examples/mdx-react/tanstack-start dev`.

For a production browser check, build the workspace, then use
`pnpm --dir examples/mdx-react/nextjs start --port 3100` and
`pnpm --dir examples/mdx-react/tanstack-start preview --port 3102`.

The installed TanStack Start client logs an `AbortError` when a streamed server
function is cancelled. Its development tools can repeat that message.
