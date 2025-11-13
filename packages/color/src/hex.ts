import type { Color } from "./rgb";

const COLOR_HEX_REGEX: RegExp = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * Parses a hex color string.
 *
 * @param value The hex color string.
 * @returns The parsed color or undefined if the hex color string is invalid.
 */
export function parseHex(value: string): Color | undefined {
  if (!COLOR_HEX_REGEX.test(value)) {
    return undefined;
  }

  let hex = value.replace("#", "");
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((char) => char + char)
      .join("");
  }

  const red = Number.parseInt(hex.substring(0, 2), 16);
  const green = Number.parseInt(hex.substring(2, 4), 16);
  const blue = Number.parseInt(hex.substring(4, 6), 16);
  if (Number.isNaN(red) || Number.isNaN(green) || Number.isNaN(blue)) {
    return undefined;
  }

  let alpha: number | undefined;
  if (hex.length === 8) {
    alpha = Number.parseInt(hex.substring(6, 8), 16) / 255;
    if (Number.isNaN(alpha)) {
      return undefined;
    }
  }

  return { red, green, blue, alpha };
}

/**
 * Converts a color to a hex color string.
 *
 * @param color The color to convert.
 * @returns A hex color string.
 */
export function toHex(color: Color): string {
  const red = color.red.toString(16).padStart(2, "0");
  const green = color.green.toString(16).padStart(2, "0");
  const blue = color.blue.toString(16).padStart(2, "0");

  let value = `${red}${green}${blue}`;

  if (color.alpha !== undefined) {
    const alpha = Math.round(color.alpha * 255)
      .toString(16)
      .padStart(2, "0");
    value += alpha;
  }

  return value;
}

/**
 * Converts a color to a hex CSS value with a leading hash.
 *
 * @param color The color to convert.
 * @returns A hex CSS value.
 */
export function toHexHash(color: Color): string {
  return `#${toHex(color)}`;
}
