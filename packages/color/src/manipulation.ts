import { hslToRgb, rgbToHsl } from "./hsl";
import { type Color, lerpRgb } from "./rgb";

/**
 * Mixes two colors together.
 *
 * @param a The first color.
 * @param b The second color.
 * @param weight The weight of the first color in the range [0, 1].
 * @returns The mixed color.
 */
export function mix(a: Color, b: Color, weight = 0.5): Color {
  return lerpRgb(a, b, 1 - weight);
}

/**
 * Lightens a color.
 *
 * @param color The color to lighten.
 * @param amount The amount to lighten by in the range [0, 1].
 * @returns The lightened color.
 */
export function lighten(color: Color, amount: number): Color {
  const hsl = rgbToHsl(color);
  return hslToRgb({
    ...hsl,
    lightness: Math.min(1, hsl.lightness + amount),
  });
}

/**
 * Darkens a color.
 *
 * @param color The color to darken.
 * @param amount The amount to darken by in the range [0, 1].
 * @returns The darkened color.
 */
export function darken(color: Color, amount: number): Color {
  const hsl = rgbToHsl(color);
  return hslToRgb({
    ...hsl,
    lightness: Math.max(0, hsl.lightness - amount),
  });
}

/**
 * Saturates a color.
 *
 * @param color The color to saturate.
 * @param amount The amount to saturate by in the range [0, 1].
 * @returns The saturated color.
 */
export function saturate(color: Color, amount: number): Color {
  const hsl = rgbToHsl(color);
  return hslToRgb({
    ...hsl,
    saturation: Math.min(1, hsl.saturation + amount),
  });
}

/**
 * Desaturates a color.
 *
 * @param color The color to desaturate.
 * @param amount The amount to desaturate by in the range [0, 1].
 * @returns The desaturated color.
 */
export function desaturate(color: Color, amount: number): Color {
  const hsl = rgbToHsl(color);
  return hslToRgb({
    ...hsl,
    saturation: Math.max(0, hsl.saturation - amount),
  });
}

/**
 * Returns the grayscale version of a color.
 *
 * @param color The color to convert to grayscale.
 * @returns The grayscale color.
 */
export function grayscale(color: Color): Color {
  return desaturate(color, 1);
}
