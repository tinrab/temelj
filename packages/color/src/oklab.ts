import type { Color } from "./rgb";

/**
 * An OKLab color.
 */
export interface OkLabColor {
  l: number;
  a: number;
  b: number;
  alpha?: number | undefined;
}

/**
 * Converts a RGB color to an OKLab color.
 *
 * @param color The RGB color.
 * @returns The OKLab color.
 */
export function rgbToOkLab(color: Color): OkLabColor {
  let r = color.red / 255;
  let g = color.green / 255;
  let b = color.blue / 255;

  r = r > 0.04045 ? ((r + 0.055) / 1.055) ** 2.4 : r / 12.92;
  g = g > 0.04045 ? ((g + 0.055) / 1.055) ** 2.4 : g / 12.92;
  b = b > 0.04045 ? ((b + 0.055) / 1.055) ** 2.4 : b / 12.92;

  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return {
    l: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720403 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.45059371 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086758033 * s_,
    alpha: color.alpha,
  };
}

/**
 * Converts an OKLab color to a RGB color.
 *
 * @param color The OKLab color.
 * @returns The RGB color.
 */
export function okLabToRgb(color: OkLabColor): Color {
  const l_ = color.l + 0.3963377774 * color.a + 0.2158037573 * color.b;
  const m_ = color.l - 0.1055613458 * color.a - 0.0638541728 * color.b;
  const s_ = color.l - 0.0894841775 * color.a - 1.291485548 * color.b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  let r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  let b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

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
