import fastEquals from "react-fast-compare";

export function deepEquals(a: unknown, b: unknown): boolean {
  return fastEquals(a, b);
}
