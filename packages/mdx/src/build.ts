import type { Schema } from "@temelj/standard-schema";

import type { CompileOptions, ProgramCompileArtifact } from "./compiler.ts";
import type { ProcessorOptions } from "./processor.ts";

import { compile } from "./compiler.ts";
import { BuildError, MdxError } from "./errors.ts";
import { Processor } from "./processor.ts";
import { SourceFile } from "./source.ts";

export interface MdxConfigOptions {
  readonly processor?: Omit<ProcessorOptions, "htmlPlugins" | "html">;
  readonly compiler?: Omit<CompileOptions, "outputFormat" | "sourceName" | "development">;
  readonly frontmatterSchema?: Schema;
}

export interface MdxBuildInput {
  readonly source: string;
  readonly filename: string;
  readonly development?: boolean;
  readonly providerImportSource?: string;
  /** Rejects async documents, which React client renderers cannot render. */
  readonly synchronous?: boolean;
}

/** Build configuration shared by bundler plugins and trusted config modules. */
export class MdxConfig {
  private readonly processor: Processor;
  private readonly options: MdxConfigOptions;

  public constructor(options: MdxConfigOptions = {}) {
    this.processor = new Processor(options.processor);
    this.options = options;
  }

  /**
   * Compiles a module without evaluating authored imports or expressions.
   * @throws {BuildError} The document is invalid or cannot be rendered synchronously.
   */
  public async transform(input: MdxBuildInput): Promise<ProgramCompileArtifact> {
    const { compiler, frontmatterSchema } = this.options;
    let artifact: ProgramCompileArtifact;

    try {
      const parsed = await this.processor.transform(
        new SourceFile({ name: input.filename, text: input.source }),
      );

      const options = {
        ...compiler,
        outputFormat: "program" as const,
        sourceName: input.filename,
        development: input.development ?? false,
        providerImportSource: input.providerImportSource ?? compiler?.providerImportSource,
      };

      ({ artifact } =
        frontmatterSchema === undefined
          ? await compile(parsed, options)
          : await compile(parsed, { ...options, frontmatterSchema }));
    } catch (cause) {
      if (cause instanceof MdxError) {
        throw BuildError.compileFailed(input.filename, cause);
      }

      throw cause;
    }

    if (input.synchronous === true && artifact.async) {
      throw BuildError.asyncDocument(input.filename);
    }

    return artifact;
  }
}

/** Identifies component requests while leaving raw and URL imports to the bundler. */
export function isMdxModule(id: string): boolean {
  const [filename, query = ""] = id.split("?");
  const parameters = new URLSearchParams(query);

  return filename.endsWith(".mdx") && !parameters.has("raw") && !parameters.has("url");
}
