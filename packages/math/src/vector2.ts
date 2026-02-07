import { clamp as mathClamp } from "./ops";

export interface Vector2 {
  x: number;
  y: number;
}

export const vector2: {
  of(x: number, y: number): Vector2;
  copy(v: Vector2): Vector2;
  zero(): Vector2;
  equals(a: Vector2, b: Vector2): boolean;
  plus(a: Vector2, b: Vector2): Vector2;
  add(v: Vector2, x: number, y: number): Vector2;
  minus(a: Vector2, b: Vector2): Vector2;
  subtract(v: Vector2, x: number, y: number): Vector2;
  times(a: Vector2, b: Vector2): Vector2;
  multiply(v: Vector2, x: number, y: number): Vector2;
  divided(a: Vector2, b: Vector2): Vector2;
  divide(v: Vector2, x: number, y: number): Vector2;
  scale(v: Vector2, x: number): Vector2;
  negate(v: Vector2): Vector2;
  snap(v: Vector2, size: number): Vector2;
  clamp(v: Vector2, min: Vector2, max: Vector2): Vector2;
  clampMin(v: Vector2, min: Vector2): Vector2;
  clampMax(v: Vector2, max: Vector2): Vector2;
  displayString(v: Vector2): string;
} = {
  of(x: number, y: number): Vector2 {
    return { x, y };
  },

  copy(v: Vector2): Vector2 {
    return { x: v.x, y: v.y };
  },

  zero(): Vector2 {
    return this.of(0, 0);
  },

  equals(a: Vector2, b: Vector2): boolean {
    return a.x === b.x && a.y === b.y;
  },

  plus(a: Vector2, b: Vector2): Vector2 {
    return this.of(a.x + b.x, a.y + b.y);
  },

  add(v: Vector2, x: number, y: number): Vector2 {
    return this.of(v.x + x, v.y + y);
  },

  minus(a: Vector2, b: Vector2): Vector2 {
    return this.of(a.x - b.x, a.y - b.y);
  },

  subtract(v: Vector2, x: number, y: number): Vector2 {
    return this.of(v.x - x, v.y - y);
  },

  times(a: Vector2, b: Vector2): Vector2 {
    return this.of(a.x * b.x, a.y * b.y);
  },

  multiply(v: Vector2, x: number, y: number): Vector2 {
    return this.of(v.x * x, v.y * y);
  },

  divided(a: Vector2, b: Vector2): Vector2 {
    return this.of(a.x / b.x, a.y / b.y);
  },

  divide(v: Vector2, x: number, y: number): Vector2 {
    return this.of(v.x / x, v.y / y);
  },

  scale(v: Vector2, x: number): Vector2 {
    return this.of(v.x * x, v.y * x);
  },

  negate(v: Vector2): Vector2 {
    return this.of(-v.x, -v.y);
  },

  snap(v: Vector2, size: number): Vector2 {
    return this.of(
      size * Math.round(v.x / size),
      size * Math.round(v.y / size),
    );
  },

  clamp(v: Vector2, min: Vector2, max: Vector2): Vector2 {
    return this.of(mathClamp(v.x, min.x, max.x), mathClamp(v.y, min.y, max.y));
  },

  clampMin(v: Vector2, min: Vector2): Vector2 {
    return this.of(v.x < min.x ? min.x : v.x, v.y < min.y ? min.y : v.y);
  },

  clampMax(v: Vector2, max: Vector2): Vector2 {
    return this.of(v.x > max.x ? max.x : v.x, v.y > max.y ? max.y : v.y);
  },

  displayString(v: Vector2): string {
    return `Vector2(${v.x}, ${v.y})`;
  },
} as const;
