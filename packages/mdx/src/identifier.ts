export function normalizeIdentifier(value: string): string {
  return value
    .replace(/[\t\n\r ]+/gu, " ")
    .replace(/^ | $/gu, "")
    .toLowerCase()
    .toUpperCase();
}
