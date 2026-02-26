import type { Color } from "./rgb";

/**
 * Calculates the relative luminance of a RGB color.
 *
 * @param color The color to calculate the luminance for.
 * @returns The relative luminance.
 * @see https://www.w3.org/TR/WCAG20/#relativeluminancedef
 */
export function getLuminance(color: Color): number {
  const r = color.red / 255;
  const g = color.green / 255;
  const b = color.blue / 255;

  const R = r <= 0.03928 ? r / 12.92 : ((r + 0.055) / 1.055) ** 2.4;
  const G = g <= 0.03928 ? g / 12.92 : ((g + 0.055) / 1.055) ** 2.4;
  const B = b <= 0.03928 ? b / 12.92 : ((b + 0.055) / 1.055) ** 2.4;

  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/**
 * Calculates the contrast ratio between two RGB colors.
 *
 * @param a The first color.
 * @param b The second color.
 * @returns The contrast ratio in the range [1, 21].
 * @see https://www.w3.org/TR/WCAG20/#contrast-ratiodef
 */
export function getContrastRatio(a: Color, b: Color): number {
  const l1 = getLuminance(a);
  const l2 = getLuminance(b);

  const lightest = Math.max(l1, l2);
  const darkest = Math.min(l1, l2);

  return (lightest + 0.05) / (darkest + 0.05);
}
