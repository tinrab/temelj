/**
 * Options for case conversions.
 */
export interface ConvertCaseOptions {
  /**
   * A function to split a string into parts.
   */
  split?: (s: string) => string[];
}

/**
 * Converts a string to camel case.
 *
 * @param s The string to convert.
 * @param options Optional options for the conversion.
 * @returns The converted string.
 */
export function toCamelCase(s: string, options?: ConvertCaseOptions): string {
  if (s.length === 0) {
    return s;
  }
  let result = "";
  for (const [i, part] of caseSplit(s, options).entries()) {
    result += i === 0 ? part.toLowerCase() : capitalize(part);
  }
  return result;
}

/**
 * Converts a string to snake case.
 *
 * @param s The string to convert.
 * @param options Optional options for the conversion.
 * @returns The converted string.
 */
export function toSnakeCase(s: string, options?: ConvertCaseOptions): string {
  if (s.length === 0) {
    return s;
  }
  const parts = caseSplit(s, options);
  let result = "";
  for (const [i, part] of parts.entries()) {
    result += part.toLowerCase();
    if (i < parts.length - 1) {
      result += "_";
    }
  }
  return result;
}

/**
 * Converts a string to pascal case.
 *
 * @param s The string to convert.
 * @param options Optional options for the conversion.
 * @returns The converted string.
 */
export function toPascalCase(s: string, options?: ConvertCaseOptions): string {
  if (s.length === 0) {
    return s;
  }
  let result = "";
  for (const part of caseSplit(s, options)) {
    result += capitalize(part);
  }
  return result;
}

/**
 * Converts a string to title case.
 *
 * @param s The string to convert.
 * @param options Optional options for the conversion.
 * @returns The converted string.
 */
export function toTitleCase(s: string, options?: ConvertCaseOptions): string {
  if (s.length === 0) {
    return s;
  }
  let result = "";
  for (const part of caseSplit(s, options)) {
    result += `${capitalize(part)} `;
  }
  return result.trim();
}

/**
 * Converts a string to kebab case.
 *
 * @param s The string to convert.
 * @param options Optional options for the conversion.
 * @returns The converted string.
 */
export function toKebabCase(s: string, options?: ConvertCaseOptions): string {
  if (s.length === 0) {
    return s;
  }
  const parts = caseSplit(s, options);
  let result = "";
  for (const [i, part] of parts.entries()) {
    result += part.toLowerCase();
    if (i < parts.length - 1) {
      result += "-";
    }
  }
  return result;
}

/**
 * Capitalizes the first letter of a string.
 *
 * @param s The string to capitalize.
 * @returns The capitalized string.
 */
export function capitalize(s: string): string {
  if (s.length === 0) {
    return s;
  }
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Splits a string into parts based on case changes.
 *
 * @param s The string to split.
 * @param options Optional options for the split.
 * @returns The split string.
 */
export function caseSplit(s: string, options?: ConvertCaseOptions): string[] {
  if (options?.split !== undefined) {
    return options.split(s);
  }

  const parts: string[] = [];
  const NUMBER_REGEX = /\d/;

  let part = "";
  let last = "";
  for (const c of s) {
    if (c === " " || c === "." || c === "_" || c === "-") {
      if (part.length > 0) {
        parts.push(part);
        part = "";
      }
    } else if (NUMBER_REGEX.test(c)) {
      part += c;
    } else if (c === c.toUpperCase() && c !== c.toLowerCase()) {
      if (part.length > 0 && last !== last.toUpperCase()) {
        parts.push(part);
        part = "";
      }
      part += c.toLowerCase();
    } else {
      part += c;
    }
    last = c;
  }
  if (part.length > 0) {
    parts.push(part);
  }

  return parts;
}
