<p align="center">
  <h1 align="center" style="text-decoration:none;">@temelj/react-hooks</h1>
  <br/>
  <p align="center">
    A collection of React hooks.
  </p>
</p>

<p align="center">
  <a href="https://twitter.com/tinrab" rel="nofollow"><img src="https://img.shields.io/badge/created%20by-@tinrab-1d9bf0.svg" alt="Created by Tin Rabzelj"></a>
  <a href="https://jsr.io/@temelj/react-hooks" rel="nofollow"><img src="https://jsr.io/badges/@temelj/react-hooks" alt="jsr"></a>
  <a href="https://opensource.org/licenses/MIT" rel="nofollow"><img src="https://img.shields.io/github/license/tinrab/temelj" alt="License"></a>
</p>

<div align="center">
  <a href="https://jsr.io/@temelj/react-hooks">jsr</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://www.npmjs.com/package/@temelj/react-hooks">npm</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://github.com/tinrab/temelj/issues/new">Issues</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://twitter.com/tinrab">@tinrab</a>
  <br />
</div>

<br/>
<br/>

## Installation

```sh
# npm
$ npm install @temelj/react-hooks
# jsr
$ deno add jsr:@temelj/react-hooks # or jsr add @temelj/react-hooks
```

## Hooks

### Async

- `useAbortController`
- `useAsyncQueue`
- `useAsyncResult`
- `useAsyncTask`
- `useDebouncedCallback`
- `useLimitedCallback`
- `useRetry`
- `useRetryingAsyncResult`
- `useThrottledCallback`
- `useTimeoutAsyncResult`
- `useTimeoutResult`

### Browser

- `useBattery`
- `useBeforeUnload`
- `useBreakpoint`
- `useClickAway`
- `useClipboardResult`
- `useColorScheme`
- `useCopyToClipboard`
- `useDocumentEvent`
- `useDocumentTitle`
- `useEventListenerRef`
- `useEventListener`
- `useFavicon`
- `useFocusReturn`
- `useFocusTrap`
- `useGeolocation`
- `useHover`
- `useIdle`
- `useIntersectionObserver`
- `useIsClient`
- `useIsMobile`
- `useKeyPress`
- `useLocalStorage`
- `useLockBodyScroll`
- `useLongPress`
- `useMeasure`
- `useMediaQueries`
- `useMediaQuery`
- `useMergedRefs`
- `useMouse`
- `useMutationObserver`
- `useNetworkState`
- `useOnlineResult`
- `useOrientation`
- `usePageLeave`
- `usePreferredLanguage`
- `usePrefersReducedMotion`
- `useScript`
- `useScrollLock`
- `useSessionStorage`
- `useVisibilityChange`
- `useWindowEvent`
- `useWindowScroll`
- `useWindowSize`

### Collections

- `useList`
- `useMap`
- `useQueue`
- `useSet`

### Math

- `useDragRect`
- `useDragVector`
- `useElementCenter`
- `useElementRect`
- `useMouseVector`
- `usePointerVector`
- `useRectIntersection`
- `useRect`
- `useResizeObserver`

### State

- `useAsyncResultEffect`
- `useBoolean`
- `useControllableState`
- `useCounter`
- `useDefault`
- `useDisclosure`
- `useEnumState`
- `useHistoryState`
- `useIsomorphicLayoutEffect`
- `useLatestRef`
- `useMounted`
- `useObjectState`
- `usePrevious`
- `useRenderInfo`
- `useResultEffect`
- `useResultMemo`
- `useResultReducer`
- `useResultState`
- `useStableCallback`
- `useToggle`
- `useUndoRedo`

### Timers

- `useAnimationFrame`
- `useContinuousRetry`
- `useCountdown`
- `useDebounce`
- `useIntervalCallback`
- `useIntervalWhen`
- `useInterval`
- `useRafLoop`
- `useRandomInterval`
- `useThrottle`
- `useTimeoutCallback`
- `useTimeout`

## Results and errors

Result hooks return `Error` for thrown values by default. An optional `mapError`
converts caught values into a domain error. With a mapper, the error type is
`E | Error` because the mapper itself can throw. Unmapped errors preserve existing
`Error` instances; other thrown values become an `Error` with the original cause.

`useAsyncResult` and its retry/timeout variants require `initialArgs` when
`immediate: true`, including `[]` for functions without arguments. Resetting or
starting a newer execution prevents obsolete completions from updating state.

`useResultEffect` callbacks return `{ value, cleanup? }`. This keeps function-valued
results separate from lifecycle cleanup. Abort controls accept an `Error` or
message; resetting a controller aborts the previous operation.

`useAsyncQueue` tracks waiting and running tasks through queue subscriptions.
Clearing the queue or unmounting rejects waiting tasks with `AbortError`; already
running tasks continue.

## Browser storage

`useLocalStorage(key, initialValue, codec)` and `useSessionStorage` require a
`StorageCodec<T>` with `parse(text): T` and `serialize(value): string`. The parser
must validate persisted text before returning a domain value. Parse failures
propagate to the caller's error boundary.

Both hooks return `[value, { set, update, remove }]`. The initial value is a
fallback for a missing key; it is not written automatically. `update` reads the
latest stored value, so multiple updates in one event compose. `remove` deletes
the key and restores the fallback. Null and function-valued data remain distinct
from these controls.

## Render tracking

`usePrevious(value, isEqual?)` returns the previous distinct value. It starts at
`undefined` and updates when the comparator, which defaults to `Object.is`, reports
a change.

`useRenderInfo(report)` returns a callback for React's `Profiler`. The report
contains committed render counts, phase, duration, and time since the previous
commit. It does not trigger a render or log automatically.

```tsx
const onRender = useRenderInfo((info) => console.log(info));
return (
  <Profiler id="editor" onRender={onRender}>
    <Editor />
  </Profiler>
);
```

## About

This package is part of [Temelj](https://github.com/tinrab/temelj) - a core library for TypeScript.
