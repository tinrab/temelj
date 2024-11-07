export function clamp<T extends number | bigint>(x: T, min: T, max: T): T {
  return x < min ? min : x > max ? max : x;
}

export function clampWithOverflow<T extends number | bigint>(
  x: T,
  min: T,
  max: T,
): T {
  if (x < min) {
    // @ts-ignore cast as number or bigint
    return max - ((min - x) % (max - min));
  }
  if (x > max) {
    // @ts-ignore cast as number or bigint
    return min + ((x - max) % (max - min));
  }
  return x;
}
