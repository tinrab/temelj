import { MdxError } from "@temelj/mdx";

export type EvaluationIssue =
  | Readonly<{ kind: "importResolverMissing"; imports: readonly string[] }>
  | Readonly<{ kind: "scopeBindings"; bindings: readonly string[] }>
  | Readonly<{ kind: "importResolution"; specifier: string }>
  | Readonly<{ kind: "importModule"; specifier: string }>
  | Readonly<{ kind: "module" }>
  | Readonly<{ kind: "execution" }>;

export class EvaluationError extends MdxError {
  public readonly sourceName: string;
  public readonly issue: EvaluationIssue;

  private constructor(
    message: string,
    sourceName: string,
    issue: EvaluationIssue,
    options: ErrorOptions,
    context: Function,
  ) {
    super("EvaluationError", message, options, context);
    this.sourceName = sourceName;
    this.issue = Object.freeze(issue);
  }

  public static missingImportResolver(
    this: void,
    sourceName: string,
    imports: readonly string[],
  ): EvaluationError {
    return new EvaluationError(
      `MDX imports require resolveImport: ${imports.join(", ")}`,
      sourceName,
      { kind: "importResolverMissing", imports: Object.freeze([...imports]) },
      {},
      EvaluationError.missingImportResolver,
    );
  }

  public static invalidScopeBindings(
    this: void,
    sourceName: string,
    bindings: readonly string[],
    options: ErrorOptions = {},
  ): EvaluationError {
    return new EvaluationError(
      `Invalid trusted MDX scope bindings: ${bindings.map((name) => JSON.stringify(name)).join(", ")}`,
      sourceName,
      { kind: "scopeBindings", bindings: Object.freeze([...bindings]) },
      options,
      EvaluationError.invalidScopeBindings,
    );
  }

  public static importResolutionFailed(
    this: void,
    sourceName: string,
    specifier: string,
    cause: unknown,
  ): EvaluationError {
    return new EvaluationError(
      `Could not resolve trusted MDX import ${JSON.stringify(specifier)}`,
      sourceName,
      { kind: "importResolution", specifier },
      { cause },
      EvaluationError.importResolutionFailed,
    );
  }

  public static invalidImportModule(
    this: void,
    sourceName: string,
    specifier: string,
  ): EvaluationError {
    return new EvaluationError(
      `Resolver returned a non-module value for ${JSON.stringify(specifier)}`,
      sourceName,
      { kind: "importModule", specifier },
      {},
      EvaluationError.invalidImportModule,
    );
  }

  public static invalidModule(this: void, sourceName: string): EvaluationError {
    return new EvaluationError(
      "Trusted MDX did not evaluate to a module with a default component",
      sourceName,
      { kind: "module" },
      {},
      EvaluationError.invalidModule,
    );
  }

  public static executionFailed(this: void, sourceName: string, cause: unknown): EvaluationError {
    return new EvaluationError(
      `Trusted MDX evaluation failed in ${sourceName}`,
      sourceName,
      { kind: "execution" },
      { cause },
      EvaluationError.executionFailed,
    );
  }
}
