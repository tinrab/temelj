import type { Color } from "./rgb";

/**
 * A Lab color.
 */
export interface LabColor {
  l: number;
  a: number;
  b: number;
  alpha?: number | undefined;
}

const XN = 0.95047;
const YN = 1.0;
const ZN = 1.08883;

/**
 * Converts a RGB color to a Lab color.
 *
 * @param color The RGB color.
 * @returns The Lab color.
 */
export function rgbToLab(color: Color): LabColor {
  let r = color.red / 255;
  let g = color.green / 255;
  let b = color.blue / 255;

  r = r > 0.04045 ? ((r + 0.055) / 1.055) ** 2.4 : r / 12.92;
  g = g > 0.04045 ? ((g + 0.055) / 1.055) ** 2.4 : g / 12.92;
  b = b > 0.04045 ? ((b + 0.055) / 1.055) ** 2.4 : b / 12.92;

  let x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / XN;
  let y = (r * 0.2126729 + g * 0.7151522 + b * 0.072175) / YN;
  let z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / ZN;

  x = x > 0.008856 ? x ** (1 / 3) : 7.787 * x + 16 / 116;
  y = y > 0.008856 ? y ** (1 / 3) : 7.787 * y + 16 / 116;
  z = z > 0.008856 ? z ** (1 / 3) : 7.787 * z + 16 / 116;

  return {
    l: 116 * y - 16,
    a: 500 * (x - y),
    b: 200 * (y - z),
    alpha: color.alpha,
  };
}

/**
 * Converts a Lab color to a RGB color.
 *
 * @param color The Lab color.
 * @returns The RGB color.
 */
export function labToRgb(color: LabColor): Color {
  let y = (color.l + 16) / 116;
  let x = color.a / 500 + y;
  let z = y - color.b / 200;

  x = x ** 3 > 0.008856 ? x ** 3 : (x - 16 / 116) / 7.787;
  y = y ** 3 > 0.008856 ? y ** 3 : (y - 16 / 116) / 7.787;
  z = z ** 3 > 0.008856 ? z ** 3 : (z - 16 / 116) / 7.787;

  x *= XN;
  y *= YN;
  z *= ZN;

  let r = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
  let g = x * -0.969266 + y * 1.8760108 + z * 0.041556;
  let b = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;

  r = r > 0.0031308 ? 1.055 * r ** (1 / 2.4) - 0.055 : 12.92 * r;
  g = g > 0.0031308 ? 1.055 * g ** (1 / 2.4) - 0.055 : 12.92 * g;
  b = b > 0.0031308 ? 1.055 * b ** (1 / 2.4) - 0.055 : 12.92 * b;

  return {
    red: Math.max(0, Math.min(255, Math.round(r * 255))),
    green: Math.max(0, Math.min(255, Math.round(g * 255))),
    blue: Math.max(0, Math.min(255, Math.round(b * 255))),
    alpha: color.alpha,
  };
}
