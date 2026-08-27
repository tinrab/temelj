export type HeadingDepth = 1 | 2 | 3 | 4 | 5 | 6;

export function isHeadingDepth(value: unknown): value is HeadingDepth {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5 || value === 6;
}

export function headingDepthForTag(tagName: string): HeadingDepth | undefined {
  switch (tagName) {
    case "h1":
      return 1;
    case "h2":
      return 2;
    case "h3":
      return 3;
    case "h4":
      return 4;
    case "h5":
      return 5;
    case "h6":
      return 6;
    default:
      return undefined;
  }
}
