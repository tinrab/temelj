export interface ConvertCaseOptions {
  split?: (s: string) => string[];
}

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

export function capitalize(s: string): string {
  if (s.length === 0) {
    return s;
  }
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

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
