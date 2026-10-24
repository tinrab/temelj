import type { ReactNode } from "react";

export function useMDXComponents() {
  return {
    h1: ({ children }: { children?: ReactNode }) => (
      <h1 className="text-2xl font-semibold">{children}</h1>
    ),
  };
}
