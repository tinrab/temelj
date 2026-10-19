import { AbortError } from "@temelj/async";
import * as React from "react";

import { useLatest } from "./mod.ts";

type Callback<Args extends unknown[], R> = (...args: Args) => PromiseLike<R> | R;

type LimitedCallback<Args extends unknown[], R> = (...args: Args) => Promise<R>;

type LimiterFactory<Args extends unknown[], R, Config> = (
  callback: Callback<Args, R>,
  config: Config,
  signal: AbortSignal,
) => LimitedCallback<Args, R>;

/** Creates timer-backed limiters only when called, and cancels them on replacement or unmount. */
export function useRateLimitedCallback<Args extends unknown[], R, Config>(
  fn: Callback<Args, R>,
  config: Config,
  create: LimiterFactory<Args, R, Config>,
): LimitedCallback<Args, R> {
  const fnRef = useLatest(fn);
  const latestConfig = useLatest({ config, create });
  const active = React.useRef(true);

  const current = React.useRef<
    | {
        readonly config: Config;
        readonly create: LimiterFactory<Args, R, Config>;
        readonly controller: AbortController;
        readonly callback: LimitedCallback<Args, R>;
      }
    | undefined
  >(undefined);

  React.useEffect(() => {
    active.current = true;

    return () => {
      active.current = false;
      current.current?.controller.abort();
      current.current = undefined;
    };
  }, []);

  React.useEffect(
    () => () => {
      const limiter = current.current;

      if (limiter?.config === config && limiter.create === create) {
        limiter.controller.abort();
        current.current = undefined;
      }
    },
    [config, create],
  );

  return React.useCallback(
    (...args: Args) => {
      if (
        !active.current ||
        latestConfig.current.config !== config ||
        latestConfig.current.create !== create
      ) {
        return Promise.reject(AbortError.create());
      }

      let limiter = current.current;

      if (limiter === undefined || limiter.config !== config || limiter.create !== create) {
        limiter?.controller.abort();
        const controller = new AbortController();
        limiter = {
          config,
          create,
          controller,
          callback: create((...values) => fnRef.current(...values), config, controller.signal),
        };
        current.current = limiter;
      }

      return limiter.callback(...args);
    },
    [config, create, fnRef, latestConfig],
  );
}
