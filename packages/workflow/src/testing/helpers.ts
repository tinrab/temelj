export function sequentialRunIds(...ids: readonly string[]): () => string {
  let index = 0;

  return () => ids[index++] ?? `run_${index}`;
}
