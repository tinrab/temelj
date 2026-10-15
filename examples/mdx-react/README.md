# MDX React examples

Open `/streaming` to stream a document automatically. Each example passes the
response to `consume()` from `useMdxStream`, which decodes chunks, batches
updates per frame, and completes the document at EOF. `StreamContent` renders
the view. Navigating away aborts the request and leaves the preview open.

Next.js consumes a `fetch` response. TanStack Start consumes strings from a
streaming server function. Both show a CSS-only caret while streaming.

Both examples have a `/chat` page: an AI-chat transcript where every answer
streams into its own `useMdxStream`. "Ask three at once" streams several answers
concurrently while earlier ones stay settled. Next.js reads each answer from a
`fetch` response; TanStack Start reads it from a streaming server function.

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
