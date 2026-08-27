import type { SourceSpan } from "./model.ts";

export type DiagnosticSeverity = "info" | "warning" | "error";

export interface RelatedInformation {
  readonly message: string;
  readonly span: SourceSpan;
}

export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly span?: SourceSpan;
  readonly notes?: readonly string[];
  readonly related?: readonly RelatedInformation[];
}

export interface DiagnosticFormatOptions {
  readonly includeCode?: boolean;
  readonly includeNotes?: boolean;
  readonly includeRelated?: boolean;
}

export interface DiagnosticReporter {
  add(diagnostic: Diagnostic): void;
}

export class DiagnosticBag implements DiagnosticReporter {
  private readonly values: Diagnostic[] = [];

  public get size(): number {
    return this.values.length;
  }

  public constructor(initial: readonly Diagnostic[] = []) {
    this.extend(initial);
  }

  public add(diagnostic: Diagnostic): void {
    this.values.push(createDiagnostic(diagnostic));
  }

  public extend(diagnostics: readonly Diagnostic[]): void {
    for (const diagnostic of diagnostics) {
      this.add(diagnostic);
    }
  }

  public snapshot(): readonly Diagnostic[] {
    return Object.freeze([...this.values]);
  }

  public hasErrorsSince(index: number): boolean {
    for (let current = index; current < this.values.length; current++) {
      if (this.values[current].severity === "error") {
        return true;
      }
    }
    return false;
  }
}

export function formatDiagnostic(
  diagnostic: Diagnostic,
  options: DiagnosticFormatOptions = {},
): string {
  const location = diagnostic.span === undefined ? "" : formatSpan(diagnostic.span);
  const code = options.includeCode === false ? "" : ` [${diagnostic.code}]`;
  const lines = [`${location}${diagnostic.severity}${code}: ${diagnostic.message}`];
  if (options.includeNotes !== false) {
    for (const note of diagnostic.notes ?? []) {
      lines.push(`note: ${note}`);
    }
  }
  if (options.includeRelated !== false) {
    for (const related of diagnostic.related ?? []) {
      lines.push(`related ${formatSpan(related.span)}${related.message}`);
    }
  }
  return lines.join("\n");
}

export function hasErrorDiagnostics(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

export function createDiagnostic(diagnostic: Diagnostic): Diagnostic {
  return Object.freeze({
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    span: diagnostic.span === undefined ? undefined : Object.freeze({ ...diagnostic.span }),
    notes: diagnostic.notes === undefined ? undefined : Object.freeze([...diagnostic.notes]),
    ...(diagnostic.related === undefined
      ? {}
      : {
          related: Object.freeze(
            diagnostic.related.map((item) =>
              Object.freeze({
                message: item.message,
                span: Object.freeze({ ...item.span }),
              }),
            ),
          ),
        }),
  });
}

function formatSpan(span: SourceSpan): string {
  const start = span.file.location(span.start);
  const end = span.file.location(span.end);
  return `${start.line}:${start.column}-${end.line}:${end.column} `;
}
