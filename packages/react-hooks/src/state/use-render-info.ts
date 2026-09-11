import * as React from "react";

/** Measurements for a committed render of a React Profiler subtree. */
export interface RenderInfo {
  /** Profiler identifier. */
  readonly id: string;
  /** React's phase for this commit. */
  readonly phase: Parameters<React.ProfilerOnRenderCallback>[1];
  /** Number of commits observed by this callback. */
  readonly renders: number;
  /** Milliseconds since the previous commit, or zero on mount. */
  readonly sinceLastRender: number;
  /** Time spent rendering the subtree in this update. */
  readonly actualDuration: number;
  /** Estimated time to render the whole subtree without memoization. */
  readonly baseDuration: number;
  /** Time when React began this render. */
  readonly startTime: number;
  /** Time when React committed this update. */
  readonly commitTime: number;
}

/** Returns a Profiler callback that reports committed renders without mutating state during render. */
export function useRenderInfo(report: (info: RenderInfo) => void): React.ProfilerOnRenderCallback {
  const history = React.useRef({ renders: 0, commitTime: 0 });

  return React.useCallback(
    (id, phase, actualDuration, baseDuration, startTime, commitTime) => {
      const previous = history.current;
      const renders = previous.renders + 1;
      const sinceLastRender = previous.renders === 0 ? 0 : commitTime - previous.commitTime;
      history.current = { renders, commitTime };
      report({
        id,
        phase,
        renders,
        sinceLastRender,
        actualDuration,
        baseDuration,
        startTime,
        commitTime,
      });
    },
    [report],
  );
}
