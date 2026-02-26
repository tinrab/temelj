import { type LabColor, labToRgb, rgbToLab } from "./lab";
import type { Color } from "./rgb";

/**
 * An LCH color.
 */
export interface LchColor {
  l: number;
  c: number;
  h: number;
  alpha?: number | undefined;
}

/**
 * Converts a Lab color to an LCH color.
 *
 * @param color The Lab color.
 * @returns The LCH color.
 */
export function labToLch(color: LabColor): LchColor {
  const h = (Math.atan2(color.b, color.a) * 180) / Math.PI;
  return {
    l: color.l,
    c: Math.sqrt(color.a * color.a + color.b * color.b),
    h: h < 0 ? h + 360 : h,
    alpha: color.alpha,
  };
}

/**
 * Converts an LCH color to a Lab color.
 *
 * @param color The LCH color.
 * @returns The Lab color.
 */
export function lchToLab(color: LchColor): LabColor {
  const hRad = (color.h * Math.PI) / 180;
  return {
    l: color.l,
    a: Math.cos(hRad) * color.c,
    b: Math.sin(hRad) * color.c,
    alpha: color.alpha,
  };
}

/**
 * Converts a RGB color to an LCH color.
 *
 * @param color The RGB color.
 * @returns The LCH color.
 */
export function rgbToLch(color: Color): LchColor {
  return labToLch(rgbToLab(color));
}

/**
 * Converts an LCH color to a RGB color.
 *
 * @param color The LCH color.
 * @returns The RGB color.
 */
export function lchToRgb(color: LchColor): Color {
  return labToRgb(lchToLab(color));
}
