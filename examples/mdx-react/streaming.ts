export interface StreamPlaybackOptions {
  readonly signal: AbortSignal;
  readonly speed: () => number;
}

/**
 * Paces received text locally so speed changes apply to an active stream.
 * @yields At most 32 characters at the current playback speed.
 */
export async function* pacedChunks(
  chunks: AsyncIterable<string>,
  options: StreamPlaybackOptions,
): AsyncGenerator<string> {
  for await (const chunk of chunks) {
    for (let offset = 0; offset < chunk.length; offset += 32) {
      await waitForChunk(40 / options.speed(), options.signal);
      yield chunk.slice(offset, offset + 32);
    }
  }
}

/**
 * Decodes a fetch response without buffering the document.
 * @yields Decoded text as the response arrives.
 */
export async function* responseChunks(response: Response): AsyncGenerator<string> {
  if (!response.ok) {
    throw new Error("Could not load the MDX stream");
  }

  if (response.body === null) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  try {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      yield decoder.decode(chunk.value, { stream: true });
    }

    yield decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function waitForChunk(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();

  return new Promise((resolve, reject) => {
    const abort = (): void => {
      clearTimeout(timer);
      reject(signal.reason);
    };

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);

    signal.addEventListener("abort", abort, { once: true });
  });
}
