import { setImmediate } from "node:timers";

export function promiseYield(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}
