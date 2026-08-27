import { HeadContent, Link, Scripts, createRootRoute } from "@tanstack/react-router";

import appCss from "../styles/main.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "MDX",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  notFoundComponent: () => (
    <main className="container mx-auto p-4 pt-16">
      <h1>404</h1>
      <p>The requested page could not be found.</p>
    </main>
  ),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <main className="mx-auto flex min-h-svh w-full max-w-4xl flex-col gap-8 p-6">
          <header className="flex flex-wrap items-center gap-4 border-b pb-6">
            <h2 className="font-semibold">TanStack</h2>
            <div className="flex items-center gap-2">
              <Link className="text-sm underline underline-offset-4" to="/">
                Static
              </Link>
              <Link className="text-sm underline underline-offset-4" to="/streaming">
                Streaming
              </Link>
            </div>
          </header>

          {children}
        </main>

        {/* <TanStackDevtools
          config={{
            position: "bottom-right",
          }}
          plugins={[
            {
              name: "Tanstack Router",
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        /> */}
        <Scripts />
      </body>
    </html>
  );
}
