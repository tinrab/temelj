import * as React from "react";

import { isBrowser } from "../internal/mod.ts";

/** Named media queries. */
export type MediaQueries<K extends string> = Readonly<Record<K, string>>;

/** Match state for each query name. */
export type MediaQueryMatches<K extends string> = { readonly [P in K]: boolean };

/** Returns a boolean result for each own enumerable query name. */
export function useMediaQueries<K extends string>(queries: MediaQueries<K>): MediaQueryMatches<K> {
  const entries = Object.entries<string>(queries);

  const subscribe = React.useCallback(
    (callback: () => void) => {
      if (!isBrowser) return () => {};

      const lists = Object.values<string>(queries).map((query) => window.matchMedia(query));

      for (const list of lists) list.addEventListener("change", callback);

      return () => {
        for (const list of lists) list.removeEventListener("change", callback);
      };
    },
    [queries],
  );

  const getSnapshot = React.useCallback(
    () =>
      Object.values<string>(queries)
        .map((query) => (isBrowser && window.matchMedia(query).matches ? "1" : "0"))
        .join(""),
    [queries],
  );

  const getServerSnapshot = React.useCallback(
    () => "0".repeat(Object.keys(queries).length),
    [queries],
  );

  const matches = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // SAFETY: Each own enumerable query key is copied exactly once, with its corresponding boolean snapshot value.
  return Object.fromEntries(
    entries.map(([key], index) => [key, matches[index] === "1"]),
  ) as MediaQueryMatches<K>;
}
