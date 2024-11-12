/**
 * A color.
 */
export type Color = {
  red: number;
  green: number;
  blue: number;
  alpha?: number;
};

// deno-lint-ignore no-namespace
export namespace Color {
  /**
   * Creates a new color.
   *
   * @param red The red component of the color.
   * @param green The green component of the color.
   * @param blue The blue component of the color.
   * @param alpha The alpha component of the color.
   * @returns A new color.
   */
  export function of(
    red: number,
    green: number,
    blue: number,
    alpha?: number,
  ): Color {
    return { red, green, blue, alpha };
  }

  /**
   * Converts a color to a CSS color string.
   *
   * @param c The color to convert.
   * @returns A CSS color string.
   */
  export function toRgbaString(c: Color): string {
    return `rgba(${c.red}, ${c.green}, ${c.blue}, ${c.alpha ?? 1})`;
  }

  /**
   * Converts a color to a string for easy display.
   *
   * @param c The color to convert.
   * @returns A display string.
   */
  export function displayString(c: Color): string {
    if (c.alpha === undefined) {
      return `Color(${c.red}, ${c.green}, ${c.blue})`;
    }
    return `Color(${c.red}, ${c.green}, ${c.blue}, ${c.alpha})`;
  }
}
