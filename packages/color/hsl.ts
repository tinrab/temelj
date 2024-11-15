import type { Color } from "./rgb.ts";

/**
 * An HSL color.
 */
export interface HslColor {
  hue: number;
  saturation: number;
  lightness: number;
  alpha?: number;
}

/**
 * Checks if the given HSL color is valid and normalized.
 *
 * @param color The color to check.
 * @returns True if the color is a valid HSL color, false otherwise.
 */
export function isValidHsl(color: HslColor): boolean {
  return Number.isFinite(color.hue) && color.hue >= 0 && color.hue <= 360 &&
    Number.isFinite(color.saturation) && color.saturation >= 0 &&
    color.saturation <= 1 &&
    Number.isFinite(color.lightness) && color.lightness >= 0 &&
    color.lightness <= 1 &&
    (color.alpha === undefined ||
      (!Number.isNaN(color.alpha) && color.alpha >= 0 && color.alpha <= 1));
}

/**
 * Normalizes the given HSL color.
 *
 * @param color The color to normalize.
 * @returns The normalized color.
 */
export function normalizeHsl(color: HslColor): HslColor {
  return {
    hue: color.hue % 360,
    saturation: color.saturation < 0
      ? 0
      : color.saturation > 1
      ? 1
      : color.saturation,
    lightness: color.lightness < 0
      ? 0
      : color.lightness > 1
      ? 1
      : color.lightness,
    alpha: color.alpha === undefined
      ? undefined
      : color.alpha < 0
      ? 0
      : color.alpha > 1
      ? 1
      : color.alpha,
  };
}

/**
 * Creates a HSL color from the given HSL values.
 */
export function fromHsl(
  hue: number,
  saturation: number,
  lightness: number,
  alpha?: number,
): HslColor {
  return {
    hue,
    saturation,
    lightness,
    alpha,
  };
}

/**
 * Creates a RGB color from the given HSL values.
 *
 * @param hue - The hue of the color in degrees [0-360].
 * @param saturation - The saturation of the color [0-1].
 * @param lightness - The lightness of the color [0-1].
 * @param alpha - The alpha of the color [0-1].
 * @returns The color.
 */
export function hslToRgb(
  color: HslColor,
): Color {
  const { hue: h, saturation: s, lightness: l, alpha: a } = normalizeHsl(color);

  let r: number;
  let g: number;
  let b: number;

  if (s === 0) {
    // Achromatic (gray)
    r = g = b = l * 255; // Convert lightness to RGB
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;

    // Helper function to convert hue to RGB
    const hueToRgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    r = hueToRgb(p, q, h / 360 + 1 / 3);
    g = hueToRgb(p, q, h / 360);
    b = hueToRgb(p, q, h / 360 - 1 / 3);

    // Scale RGB values to [0-255]
    r *= 255;
    g *= 255;
    b *= 255;
  }

  return {
    red: Math.round(r),
    green: Math.round(g),
    blue: Math.round(b),
    alpha: a,
  };
}

/**
 * Converts a RGB color to a HSL color.
 *
 * @param color The RGB color.
 * @returns The HSL color.
 */
export function rgbToHsl(color: Color): HslColor {
  const r = color.red / 255.0;
  const g = color.green / 255.0;
  const b = color.blue / 255.0;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max === min) {
    // Achromatic (gray)
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }

    h /= 6;
  }

  return fromHsl(h, s, l, color.alpha);
}

/**
 * Converts a color to a CSS hsl color string.
 *
 * @param color The color to convert.
 * @returns A CSS color string.
 */
export function toHslString(color: HslColor): string {
  const h = color.hue % 360;
  const s = color.saturation < 0
    ? 0
    : color.saturation > 1
    ? 1
    : color.saturation;
  const l = color.lightness < 0 ? 0 : color.lightness > 1 ? 1 : color.lightness;
  return `hsl(${h}, ${s * 100}%, ${l * 100}%)`;
}

/**
 * Converts a color to a CSS hsla color string.
 *
 * @param color The color to convert.
 * @returns A CSS color string.
 */
export function toHslaString(color: HslColor): string {
  const c = normalizeHsl(color);
  return `hsla(${c.hue}, ${c.saturation * 100}%, ${c.lightness * 100}%, ${
    c.alpha ?? 1
  })`;
}

/**
 * Interpolates between two HSL colors.
 *
 * @param a The first color.
 * @param b The second color.
 * @param t The interpolation factor.
 */
export function lerpHsl(a: HslColor, b: HslColor, t: number): HslColor {
  let d = b.hue - a.hue;
  let ah = a.hue;
  let bh = b.hue;

  if (a.hue > bh) {
    const ht = bh;
    bh = ah;
    ah = ht;
    d = -d;
    t = 1 - t;
  }

  let h = 0;
  if (d > 0.5) {
    ah = ah + 1;
    h = (ah + t * (bh - ah)) % 1;
  }

  if (d <= 0.5) {
    h = ah + t * d;
  }

  return {
    hue: h,
    saturation: a.saturation + t * (b.saturation - a.saturation),
    lightness: a.lightness + t * (b.lightness - a.lightness),
    alpha: (a.alpha !== undefined && b.alpha !== undefined)
      ? a.alpha + (b.alpha - a.alpha) * t
      : undefined,
  };
}
