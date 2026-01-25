import type { MDXProvider as MdxProvider } from "@mdx-js/react";
import type * as React from "react";

export type { MdxProvider };

export type MdxContentComponents = React.ComponentProps<
  typeof MdxProvider
>["components"];
