import { type OkLabColor, okLabToRgb, rgbToOkLab } from "./oklab";
import type { Color } from "./rgb";

/**
 * An OKLCH color.
 */
export interface OkLchColor {
  l: number;
  c: number;
  h: number;
  alpha?: number | undefined;
}

/**
 * Converts an OKLab color to an OKLCH color.
 *
 * @param color The OKLab color.
 * @returns The OKLCH color.
 */
export function okLabToOkLch(color: OkLabColor): OkLchColor {
  const h = (Math.atan2(color.b, color.a) * 180) / Math.PI;
  return {
    l: color.l,
    c: Math.sqrt(color.a * color.a + color.b * color.b),
    h: h < 0 ? h + 360 : h,
    alpha: color.alpha,
  };
}

/**
 * Converts an OKLCH color to an OKLab color.
 *
 * @param color The OKLCH color.
 * @returns The OKLab color.
 */
export function okLchToOkLab(color: OkLchColor): OkLabColor {
  const hRad = (color.h * Math.PI) / 180;
  return {
    l: color.l,
    a: Math.cos(hRad) * color.c,
    b: Math.sin(hRad) * color.c,
    alpha: color.alpha,
  };
}

/**
 * Converts a RGB color to an OKLCH color.
 *
 * @param color The RGB color.
 * @returns The OKLCH color.
 */
export function rgbToOkLch(color: Color): OkLchColor {
  return okLabToOkLch(rgbToOkLab(color));
}

/**
 * Converts an OKLCH color to a RGB color.
 *
 * @param color The OKLCH color.
 * @returns The RGB color.
 */
export function okLchToRgb(color: OkLchColor): Color {
  return okLabToRgb(okLchToOkLab(color));
}
