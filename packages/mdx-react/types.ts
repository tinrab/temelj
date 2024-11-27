import type * as React from "react";
import type { MDXProvider as MdxProvider } from "@mdx-js/react";

export type { MdxProvider };

export type MdxContentComponents = React.ComponentProps<
  typeof MdxProvider
>["components"];
