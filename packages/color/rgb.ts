/**
 * A RGB color.
 */
export interface Color {
  red: number;
  green: number;
  blue: number;
  alpha?: number | undefined;
}

/**
 * Creates a RGB color from the given RGB values.
 */
export function fromRgb(
  red: number,
  green: number,
  blue: number,
  alpha?: number,
): Color {
  return {
    red,
    green,
    blue,
    alpha,
  };
}

/**
 * Checks if the given color is a valid RGB color.
 */
export function isValidRgb(color: Color): boolean {
  return Number.isInteger(color.red) && color.red >= 0 && color.red <= 255 &&
    Number.isInteger(color.green) && color.green >= 0 && color.green <= 255 &&
    Number.isInteger(color.blue) && color.blue >= 0 && color.blue <= 255 &&
    (color.alpha === undefined ||
      (!Number.isNaN(color.alpha) && color.alpha >= 0 && color.alpha <= 1));
}

// export function isValidHsl(color: HslColor)

const COLOR_RGB_REGEX =
  /^rgba?\(\s*(\d{1,3}|(\d{1,3}%))\s*,\s*(\d{1,3}|(\d{1,3}%))\s*,\s*(\d{1,3}|(\d{1,3}%))\s*(,\s*(0|1|0?\.\d+|1?\.\d+%))?\s*\)$/;

/**
 * Parses a RGB color string.
 *
 * @param value The RGB color string.
 * @returns The parsed color or undefined if the RGB color string is invalid.
 */
export function parseRgb(value: string): Color | undefined {
  const match = value.match(COLOR_RGB_REGEX);
  if (!match || match.length < 9) {
    return undefined;
  }

  const red = Number.parseInt(match[1], 10);
  const green = Number.parseInt(match[3], 10);
  const blue = Number.parseInt(match[5], 10);

  let alpha: number | undefined = undefined;
  if (match[0].startsWith("rgba")) {
    if (match[8] !== undefined) {
      alpha = Number.parseFloat(match[8]);
    } else {
      return undefined;
    }
  } else if (match[8] !== undefined) {
    return undefined;
  }

  const color = fromRgb(red, green, blue, alpha);

  if (!isValidRgb(color)) {
    return undefined;
  }

  return color;
}

/**
 * Converts a color to a CSS rgb color string.
 *
 * @param color The color to convert.
 * @returns A CSS color string.
 */
export function toRgbString(color: Color): string {
  return `rgb(${color.red}, ${color.green}, ${color.blue})`;
}

/**
 * Converts a color to a CSS rgba color string.
 *
 * @param color The color to convert.
 * @returns A CSS color string.
 */
export function toRgbaString(color: Color): string {
  return `rgba(${color.red}, ${color.green}, ${color.blue}, ${
    color.alpha ?? 1
  })`;
}

/**
 * Interpolates between two RGB colors.
 *
 * @param a The first color.
 * @param b The second color.
 */
export function lerpRgb(a: Color, b: Color, t: number): Color {
  return {
    red: a.red + (b.red - a.red) * t,
    green: a.green + (b.green - a.green) * t,
    blue: a.blue + (b.blue - a.blue) * t,
    alpha: (a.alpha !== undefined && b.alpha !== undefined)
      ? a.alpha + (b.alpha - a.alpha) * t
      : undefined,
  };
}
