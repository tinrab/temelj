// deno-lint-ignore-file no-namespace

import { clamp as mathClamp } from "../math/ops.ts";

export interface Vector2 {
  x: number;
  y: number;
}

export namespace Vector2 {
  export function of(x: number, y: number): Vector2 {
    return { x, y };
  }

  export function copy(v: Vector2): Vector2 {
    return { x: v.x, y: v.y };
  }

  export function zero(): Vector2 {
    return of(0, 0);
  }

  export function equals(a: Vector2, b: Vector2): boolean {
    return a.x === b.x && a.y === b.y;
  }

  export function plus(a: Vector2, b: Vector2): Vector2 {
    return of(a.x + b.x, a.y + b.y);
  }

  export function add(v: Vector2, x: number, y: number): Vector2 {
    return of(v.x + x, v.y + y);
  }

  export function minus(a: Vector2, b: Vector2): Vector2 {
    return of(a.x - b.x, a.y - b.y);
  }

  export function subtract(v: Vector2, x: number, y: number): Vector2 {
    return of(v.x - x, v.y - y);
  }

  export function times(a: Vector2, b: Vector2): Vector2 {
    return of(a.x * b.x, a.y * b.y);
  }

  export function multiply(v: Vector2, x: number, y: number): Vector2 {
    return of(v.x * x, v.y * y);
  }

  export function divided(a: Vector2, b: Vector2): Vector2 {
    return of(a.x / b.x, a.y / b.y);
  }

  export function divide(v: Vector2, x: number, y: number): Vector2 {
    return of(v.x / x, v.y / y);
  }

  export function scale(v: Vector2, x: number): Vector2 {
    return of(v.x * x, v.y * x);
  }

  export function negate(v: Vector2): Vector2 {
    return of(-v.x, -v.y);
  }

  export function snap(v: Vector2, size: number): Vector2 {
    return of(size * Math.round(v.x / size), size * Math.round(v.y / size));
  }

  export function clamp(v: Vector2, min: Vector2, max: Vector2): Vector2 {
    return of(mathClamp(v.x, min.x, max.x), mathClamp(v.y, min.y, max.y));
  }

  export function clampMin(v: Vector2, min: Vector2): Vector2 {
    return of(v.x < min.x ? min.x : v.x, v.y < min.y ? min.y : v.y);
  }

  export function clampMax(v: Vector2, max: Vector2): Vector2 {
    return of(v.x > max.x ? max.x : v.x, v.y > max.y ? max.y : v.y);
  }

  export function displayString(v: Vector2): string {
    return `Vector2(${v.x}, ${v.y})`;
  }
}
