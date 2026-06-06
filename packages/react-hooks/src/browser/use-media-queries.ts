import * as React from "react";

import { isBrowser } from "../internal/mod.ts";

function readQueries<const T extends Record<string, string>>(
  queries: T,
): { [K in keyof T]: boolean } {
  const result = {} as { [K in keyof T]: boolean };

  for (const key of Object.keys(queries) as Array<keyof T>) {
    result[key] = isBrowser && window.matchMedia(queries[key]).matches;
  }

  return result;
}

function readServerQueries<const T extends Record<string, string>>(
  queries: T,
): { [K in keyof T]: boolean } {
  const result = {} as { [K in keyof T]: boolean };

  for (const key of Object.keys(queries) as Array<keyof T>) {
    result[key] = false;
  }

  return result;
}

/**
 * Returns a boolean result for each named media query.
 */
export function useMediaQueries<const T extends Record<string, string>>(
  queries: T,
): { [K in keyof T]: boolean } {
  const [result, setResult] = React.useState(() => readServerQueries(queries));
  const queriesRef = React.useRef(queries);
  queriesRef.current = queries;
  const querySignature = Object.entries(queries)
    .map(([key, query]) => `${key}:${query}`)
    .join("\n");

  React.useEffect(() => {
    const currentQueries = queriesRef.current;
    setResult(readQueries(currentQueries));

    if (!isBrowser) {
      return;
    }
    const media = Object.values(currentQueries).map((query) => window.matchMedia(query));
    const update = () => setResult(readQueries(queriesRef.current));

    for (const query of media) query.addEventListener("change", update);

    return () => {
      for (const query of media) query.removeEventListener("change", update);
    };
  }, [querySignature]);

  return result;
}
