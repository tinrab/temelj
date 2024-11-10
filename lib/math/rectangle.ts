import { Vector2 } from "~/math/vector2.ts";

export interface Rectangle {
  position: Vector2;
  size: Vector2;
}

// deno-lint-ignore no-namespace
export namespace Rectangle {
  export function of(position: Vector2, size: Vector2): Rectangle {
    return { position, size };
  }

  export function ofBounds(
    x: number,
    y: number,
    width: number,
    height: number,
  ): Rectangle {
    return { position: Vector2.of(x, y), size: Vector2.of(width, height) };
  }

  export function fromDOM(rect: DOMRect): Rectangle {
    return ofBounds(rect.x, rect.y, rect.width, rect.height);
  }

  /**
   * Expand rectangle `a` to include rectangle `b`.
   */
  export function expand(a: Rectangle, b: Rectangle): Rectangle {
    const minX = Math.min(a.position.x, b.position.x);
    const minY = Math.min(a.position.y, b.position.y);
    const maxX = Math.max(a.position.x + a.size.x, b.position.x + b.size.x);
    const maxY = Math.max(a.position.y + a.size.y, b.position.y + b.size.y);
    return {
      position: { x: minX, y: minY },
      size: { x: maxX - minX, y: maxY - minY },
    };
  }

  /**
   * Get the center of a rectangle.
   */
  export function center(r: Rectangle): Vector2 {
    return Vector2.of(r.position.x + r.size.x / 2, r.position.y + r.size.y / 2);
  }

  /**
   * Check if rectangle `a` overlaps rectangle `b`.
   */
  export function overlaps(a: Rectangle, b: Rectangle): boolean {
    const aLeft = a.position.x;
    const aRight = a.position.x + a.size.x;
    const aTop = a.position.y;
    const aBottom = a.position.y + a.size.y;

    const bLeft = b.position.x;
    const bRight = b.position.x + b.size.x;
    const bTop = b.position.y;
    const bBottom = b.position.y + b.size.y;

    return !(aRight <= bLeft ||
      aLeft >= bRight ||
      aBottom <= bTop ||
      aTop >= bBottom);
  }

  export function displayString(r: Rectangle): string {
    return `Rectangle(${r.position.x}, ${r.position.y}, ${r.size.x}, ${r.size.y})`;
  }
}
