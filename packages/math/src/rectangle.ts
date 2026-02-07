import type { Vector2 } from "./vector2";

export interface Rectangle {
  position: Vector2;
  size: Vector2;
}

export const rectangle: {
  of(position: Vector2, size: Vector2): Rectangle;
  ofBounds(x: number, y: number, width: number, height: number): Rectangle;
  fromDOM(rect: DOMRect): Rectangle;
  expand(a: Rectangle, b: Rectangle): Rectangle;
  center(r: Rectangle): Vector2;
  overlaps(a: Rectangle, b: Rectangle): boolean;
  displayString(r: Rectangle): string;
} = {
  of(position: Vector2, size: Vector2): Rectangle {
    return { position, size };
  },

  ofBounds(x: number, y: number, width: number, height: number): Rectangle {
    return { position: { x, y }, size: { x: width, y: height } };
  },

  fromDOM(rect: DOMRect): Rectangle {
    return this.ofBounds(rect.x, rect.y, rect.width, rect.height);
  },

  /**
   * Expand rectangle `a` to include rectangle `b`.
   */
  expand(a: Rectangle, b: Rectangle): Rectangle {
    const minX = Math.min(a.position.x, b.position.x);
    const minY = Math.min(a.position.y, b.position.y);
    const maxX = Math.max(a.position.x + a.size.x, b.position.x + b.size.x);
    const maxY = Math.max(a.position.y + a.size.y, b.position.y + b.size.y);
    return {
      position: { x: minX, y: minY },
      size: { x: maxX - minX, y: maxY - minY },
    };
  },

  /**
   * Get the center of a rectangle.
   */
  center(r: Rectangle): Vector2 {
    return { x: r.position.x + r.size.x / 2, y: r.position.y + r.size.y / 2 };
  },

  /**
   * Check if rectangle `a` overlaps rectangle `b`.
   */
  overlaps(a: Rectangle, b: Rectangle): boolean {
    const aLeft = a.position.x;
    const aRight = a.position.x + a.size.x;
    const aTop = a.position.y;
    const aBottom = a.position.y + a.size.y;

    const bLeft = b.position.x;
    const bRight = b.position.x + b.size.x;
    const bTop = b.position.y;
    const bBottom = b.position.y + b.size.y;

    return !(
      aRight <= bLeft ||
      aLeft >= bRight ||
      aBottom <= bTop ||
      aTop >= bBottom
    );
  },

  displayString(r: Rectangle): string {
    return `Rectangle(${r.position.x}, ${r.position.y}, ${r.size.x}, ${r.size.y})`;
  },
} as const;
