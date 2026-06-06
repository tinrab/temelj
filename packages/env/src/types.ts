import type { StandardSchemaV1 } from "@standard-schema/spec";

export type EnvSource = Record<string, unknown>;

export type EnvSchema = Record<string, StandardSchemaV1>;

export type InferEnv<TSchema extends EnvSchema> = {
  readonly [TKey in keyof TSchema]: StandardSchemaV1.InferOutput<TSchema[TKey]>;
};

export type Simplify<T> = {
  readonly [TKey in keyof T]: T[TKey];
} & {};

export type EnvIssue = StandardSchemaV1.Issue & {
  readonly variable: string;
};

export class EnvValidationError extends Error {
  public readonly issues: ReadonlyArray<EnvIssue>;

  constructor(issues: ReadonlyArray<EnvIssue>, message = "Invalid environment variables") {
    super(message);
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

export class EnvConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvConfigurationError";
  }
}

export type EnvError = EnvValidationError | EnvConfigurationError;

export interface NormalizeEnvOptions {
  /**
   * Trim string values before validation.
   *
   * @default true
   */
  readonly trimWhitespace?: boolean;

  /**
   * Convert "true" and "false" string values to booleans before validation.
   *
   * @default true
   */
  readonly coerceBooleans?: boolean;

  /**
   * Treat empty strings as missing values after trimming, allowing schema defaults to apply.
   *
   * @default true
   */
  readonly emptyStringAsUndefined?: boolean;
}

export interface ParseEnvOptions extends NormalizeEnvOptions {
  /**
   * Runtime environment source. Defaults to process.env when available.
   */
  readonly env?: EnvSource;
}

export type ClientSchema<TPrefix extends string, TClient extends EnvSchema> = {
  readonly [TKey in keyof TClient]: TKey extends `${TPrefix}${string}`
    ? TClient[TKey]
    : `${TKey & string} must start with ${TPrefix}`;
};

export type ServerSchema<TPrefix extends string | undefined, TServer extends EnvSchema> = {
  readonly [TKey in keyof TServer]: TPrefix extends string
    ? TKey extends `${TPrefix}${string}`
      ? `${TKey & string} is reserved for client environment variables`
      : TServer[TKey]
    : TServer[TKey];
};

export interface CreateEnvOptions<
  TServer extends EnvSchema,
  TClient extends EnvSchema,
  TShared extends EnvSchema,
  TPrefix extends string,
> extends ParseEnvOptions {
  readonly server?: ServerSchema<TPrefix, TServer>;
  readonly client?: ClientSchema<TPrefix, TClient>;
  readonly shared?: TShared;
  readonly clientPrefix?: TPrefix;
  readonly isServer?: boolean;
}

export type CreateEnvOutput<
  TServer extends EnvSchema,
  TClient extends EnvSchema,
  TShared extends EnvSchema,
> = Simplify<InferEnv<TServer> & InferEnv<TClient> & InferEnv<TShared>>;

export type CreateClientEnvOutput<TClient extends EnvSchema, TShared extends EnvSchema> = Simplify<
  InferEnv<TClient> & InferEnv<TShared>
>;
