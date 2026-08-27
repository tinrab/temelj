export type FrontmatterFormat = "yaml" | "toml";
export type FrontmatterMode = "auto" | FrontmatterFormat;
export type MathFormat = "dollar" | "tex";
export type MathMode = "auto" | MathFormat;

export interface SyntaxOptions {
  readonly directives?: boolean;
  readonly frontmatter?: FrontmatterMode;
  readonly math?: MathMode;
  readonly strikethroughMarkerCount?: 1 | 2;
}

export interface ResolvedSyntaxOptions {
  readonly directives: boolean;
  readonly frontmatter: readonly FrontmatterFormat[];
  readonly math: readonly MathFormat[];
  readonly singleTilde: boolean;
}

export function resolveSyntaxOptions(options: SyntaxOptions = {}): ResolvedSyntaxOptions {
  return {
    directives: options.directives ?? false,
    frontmatter: resolveFrontmatter(options.frontmatter),
    math: resolveMath(options.math),
    singleTilde: (options.strikethroughMarkerCount ?? 1) === 1,
  };
}

function resolveMath(mode: MathMode | undefined): readonly MathFormat[] {
  if (mode === undefined) {
    return [];
  }
  if (mode === "auto") {
    return ["dollar", "tex"];
  }
  return [mode];
}

export function frontmatterFence(format: FrontmatterFormat): "---" | "+++" {
  return format === "yaml" ? "---" : "+++";
}

function resolveFrontmatter(mode: FrontmatterMode | undefined): readonly FrontmatterFormat[] {
  if (mode === undefined) {
    return [];
  }
  if (mode === "auto") {
    return ["yaml", "toml"];
  }
  return [mode];
}
