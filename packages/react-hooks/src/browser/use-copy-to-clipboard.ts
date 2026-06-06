import * as React from "react";

import { isBrowser } from "../internal/mod.ts";

function fallbackCopy(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  // TODO: deprecated
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

/**
 * Returns the last copied value and an async function that writes text to the clipboard.
 */
export function useCopyToClipboard(): [string | null, (value: string) => Promise<void>] {
  const [copied, setCopied] = React.useState<string | null>(null);
  const copy = React.useCallback(async (value: string) => {
    if (!isBrowser) return;
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      fallbackCopy(value);
    }
    setCopied(value);
  }, []);
  return [copied, copy];
}
