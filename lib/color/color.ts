export type Color = {
  red: number;
  green: number;
  blue: number;
  alpha?: number;
};

// deno-lint-ignore no-namespace
export namespace Color {
  export function of(
    red: number,
    green: number,
    blue: number,
    alpha?: number,
  ): Color {
    return { red, green, blue, alpha };
  }

  export function copy(c: Color): Color {
    return { ...c };
  }

  export function equals(a: Color, b: Color): boolean {
    return (
      a.red === b.red &&
      a.green === b.green &&
      a.blue === b.blue &&
      a.alpha === b.alpha
    );
  }

  export function toRgbaString(c: Color): string {
    return `rgba(${c.red}, ${c.green}, ${c.blue}, ${c.alpha ?? 1})`;
  }

  export function displayString(c: Color): string {
    if (c.alpha === undefined) {
      return `Color(${c.red}, ${c.green}, ${c.blue})`;
    }
    return `Color(${c.red}, ${c.green}, ${c.blue}, ${c.alpha})`;
  }
}
