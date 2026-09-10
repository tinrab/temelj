import type { Metadata } from "next";

import { Geist_Mono, Inter } from "next/font/google";
import Link from "next/link";

import { cn } from "@/lib/utils";
import "@/app/styles/globals.css";

const fontSans = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});
const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "MDX",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("font-sans antialiased", fontSans.variable, fontMono.variable)}
    >
      <body>
        <main className="mx-auto flex min-h-svh w-full max-w-4xl flex-col gap-8 p-6">
          <header className="flex flex-wrap items-center gap-4 border-b pb-6">
            <h2 className="font-semibold">Next.js</h2>
            <nav aria-label="Examples" className="flex items-center gap-2">
              <Link className="text-sm underline underline-offset-4" href="/">
                Dynamic safe
              </Link>
              <Link className="text-sm underline underline-offset-4" href="/streaming">
                Streaming
              </Link>
              <Link className="text-sm underline underline-offset-4" href="/compiled">
                Compiled SSR
              </Link>
            </nav>
          </header>

          {children}
        </main>
      </body>
    </html>
  );
}
