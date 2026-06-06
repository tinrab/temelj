import type { StandardSchemaV1 } from "@standard-schema/spec";

import { err, ok, unwrap, type Result } from "@temelj/result";

import {
  EnvConfigurationError,
  EnvValidationError,
  type CreateClientEnvOutput,
  type CreateEnvOptions,
  type CreateEnvOutput,
  type EnvError,
  type EnvIssue,
  type EnvSchema,
  type EnvSource,
  type InferEnv,
  type ParseEnvOptions,
} from "./types";

const DEFAULT_NORMALIZE_OPTIONS = {
  trimWhitespace: true,
  coerceBooleans: true,
  emptyStringAsUndefined: true,
};

export function parseEnv<TSchema extends EnvSchema>(
  schema: TSchema,
  options: ParseEnvOptions = {},
): InferEnv<TSchema> {
  return unwrap(tryParseEnv(schema, options));
}

export async function parseEnvAsync<TSchema extends EnvSchema>(
  schema: TSchema,
  options: ParseEnvOptions = {},
): Promise<InferEnv<TSchema>> {
  return unwrap(await tryParseEnvAsync(schema, options));
}

export function tryParseEnv<TSchema extends EnvSchema>(
  schema: TSchema,
  options: ParseEnvOptions = {},
): Result<InferEnv<TSchema>, EnvError> {
  return parseEnvWithMode(schema, options, false) as Result<InferEnv<TSchema>, EnvError>;
}

export async function tryParseEnvAsync<TSchema extends EnvSchema>(
  schema: TSchema,
  options: ParseEnvOptions = {},
): Promise<Result<InferEnv<TSchema>, EnvError>> {
  return parseEnvWithMode(schema, options, true) as Promise<Result<InferEnv<TSchema>, EnvError>>;
}

export function createEnv<
  TServer extends EnvSchema = {},
  TClient extends EnvSchema = {},
  TShared extends EnvSchema = {},
  const TPrefix extends string = string,
>(
  options: CreateEnvOptions<TServer, TClient, TShared, TPrefix> & { readonly isServer: false },
): CreateClientEnvOutput<TClient, TShared>;
export function createEnv<
  TServer extends EnvSchema = {},
  TClient extends EnvSchema = {},
  TShared extends EnvSchema = {},
  const TPrefix extends string = string,
>(
  options: CreateEnvOptions<TServer, TClient, TShared, TPrefix>,
): CreateEnvOutput<TServer, TClient, TShared>;
export function createEnv<
  TServer extends EnvSchema = {},
  TClient extends EnvSchema = {},
  TShared extends EnvSchema = {},
  const TPrefix extends string = string,
>(
  options: CreateEnvOptions<TServer, TClient, TShared, TPrefix>,
): CreateEnvOutput<TServer, TClient, TShared> | CreateClientEnvOutput<TClient, TShared> {
  return unwrap(tryCreateEnv(options));
}

export function tryCreateEnv<
  TServer extends EnvSchema = {},
  TClient extends EnvSchema = {},
  TShared extends EnvSchema = {},
  const TPrefix extends string = string,
>(
  options: CreateEnvOptions<TServer, TClient, TShared, TPrefix> & { readonly isServer: false },
): Result<CreateClientEnvOutput<TClient, TShared>, EnvError>;
export function tryCreateEnv<
  TServer extends EnvSchema = {},
  TClient extends EnvSchema = {},
  TShared extends EnvSchema = {},
  const TPrefix extends string = string,
>(
  options: CreateEnvOptions<TServer, TClient, TShared, TPrefix>,
): Result<CreateEnvOutput<TServer, TClient, TShared>, EnvError>;
export function tryCreateEnv<
  TServer extends EnvSchema = {},
  TClient extends EnvSchema = {},
  TShared extends EnvSchema = {},
  const TPrefix extends string = string,
>(
  options: CreateEnvOptions<TServer, TClient, TShared, TPrefix>,
): Result<
  CreateEnvOutput<TServer, TClient, TShared> | CreateClientEnvOutput<TClient, TShared>,
  EnvError
> {
  const server = (options.server ?? {}) as EnvSchema;
  const client = (options.client ?? {}) as EnvSchema;
  const shared = (options.shared ?? {}) as EnvSchema;
  const configError = validateEnvConfig(server, client, options.clientPrefix);
  if (configError) {
    return err(configError);
  }

  const isServer = options.isServer ?? isServerRuntime();
  const schema = isServer ? { ...server, ...client, ...shared } : { ...client, ...shared };

  return tryParseEnv(schema, options) as Result<
    CreateEnvOutput<TServer, TClient, TShared> | CreateClientEnvOutput<TClient, TShared>,
    EnvError
  >;
}

export async function createEnvAsync<
  TServer extends EnvSchema = {},
  TClient extends EnvSchema = {},
  TShared extends EnvSchema = {},
  const TPrefix extends string = string,
>(
  options: CreateEnvOptions<TServer, TClient, TShared, TPrefix> & { readonly isServer: false },
): Promise<CreateClientEnvOutput<TClient, TShared>>;
export async function createEnvAsync<
  TServer extends EnvSchema = {},
  TClient extends EnvSchema = {},
  TShared extends EnvSchema = {},
  const TPrefix extends string = string,
>(
  options: CreateEnvOptions<TServer, TClient, TShared, TPrefix>,
): Promise<CreateEnvOutput<TServer, TClient, TShared>>;
export async function createEnvAsync<
  TServer extends EnvSchema = {},
  TClient extends EnvSchema = {},
  TShared extends EnvSchema = {},
  const TPrefix extends string = string,
>(
  options: CreateEnvOptions<TServer, TClient, TShared, TPrefix>,
): Promise<CreateEnvOutput<TServer, TClient, TShared> | CreateClientEnvOutput<TClient, TShared>> {
  return unwrap(await tryCreateEnvAsync(options));
}

export async function tryCreateEnvAsync<
  TServer extends EnvSchema = {},
  TClient extends EnvSchema = {},
  TShared extends EnvSchema = {},
  const TPrefix extends string = string,
>(
  options: CreateEnvOptions<TServer, TClient, TShared, TPrefix> & { readonly isServer: false },
): Promise<Result<CreateClientEnvOutput<TClient, TShared>, EnvError>>;
export async function tryCreateEnvAsync<
  TServer extends EnvSchema = {},
  TClient extends EnvSchema = {},
  TShared extends EnvSchema = {},
  const TPrefix extends string = string,
>(
  options: CreateEnvOptions<TServer, TClient, TShared, TPrefix>,
): Promise<Result<CreateEnvOutput<TServer, TClient, TShared>, EnvError>>;
export async function tryCreateEnvAsync<
  TServer extends EnvSchema = {},
  TClient extends EnvSchema = {},
  TShared extends EnvSchema = {},
  const TPrefix extends string = string,
>(
  options: CreateEnvOptions<TServer, TClient, TShared, TPrefix>,
): Promise<
  Result<
    CreateEnvOutput<TServer, TClient, TShared> | CreateClientEnvOutput<TClient, TShared>,
    EnvError
  >
> {
  const server = (options.server ?? {}) as EnvSchema;
  const client = (options.client ?? {}) as EnvSchema;
  const shared = (options.shared ?? {}) as EnvSchema;
  const configError = validateEnvConfig(server, client, options.clientPrefix);
  if (configError) {
    return err(configError);
  }

  const isServer = options.isServer ?? isServerRuntime();
  const schema = isServer ? { ...server, ...client, ...shared } : { ...client, ...shared };

  return tryParseEnvAsync(schema, options) as Promise<
    Result<
      CreateEnvOutput<TServer, TClient, TShared> | CreateClientEnvOutput<TClient, TShared>,
      EnvError
    >
  >;
}

function parseEnvWithMode<TSchema extends EnvSchema>(
  schema: TSchema,
  options: ParseEnvOptions,
  asyncMode: false,
): Result<InferEnv<TSchema>, EnvError>;
function parseEnvWithMode<TSchema extends EnvSchema>(
  schema: TSchema,
  options: ParseEnvOptions,
  asyncMode: true,
): Promise<Result<InferEnv<TSchema>, EnvError>>;
function parseEnvWithMode<TSchema extends EnvSchema>(
  schema: TSchema,
  options: ParseEnvOptions,
  asyncMode: boolean,
): Result<InferEnv<TSchema>, EnvError> | Promise<Result<InferEnv<TSchema>, EnvError>> {
  const envResult = resolveEnv(options.env);
  if (envResult.kind === "error") {
    return err(envResult.error);
  }

  const input = normalizeEnv(envResult.value, Object.keys(schema), options);
  if (asyncMode) {
    return parseSchemaAsync(schema, input);
  }
  return parseSchemaSync(schema, input);
}

function parseSchemaSync<TSchema extends EnvSchema>(
  schema: TSchema,
  input: EnvSource,
): Result<InferEnv<TSchema>, EnvError> {
  const value: Record<string, unknown> = {};
  const issues: EnvIssue[] = [];

  for (const key of Object.keys(schema)) {
    const result = schema[key]["~standard"].validate(input[key]);
    if (result instanceof Promise) {
      return err(
        new EnvConfigurationError(
          `Environment variable ${key} uses an async schema. Use tryParseEnvAsync or parseEnvAsync instead.`,
        ),
      );
    }
    collectResult(key, result, value, issues);
  }

  return issues.length > 0 ? err(new EnvValidationError(issues)) : ok(value as InferEnv<TSchema>);
}

async function parseSchemaAsync<TSchema extends EnvSchema>(
  schema: TSchema,
  input: EnvSource,
): Promise<Result<InferEnv<TSchema>, EnvError>> {
  const value: Record<string, unknown> = {};
  const issues: EnvIssue[] = [];

  await Promise.all(
    Object.keys(schema).map(async (key) => {
      const result = await schema[key]["~standard"].validate(input[key]);
      collectResult(key, result, value, issues);
    }),
  );

  return issues.length > 0 ? err(new EnvValidationError(issues)) : ok(value as InferEnv<TSchema>);
}

function collectResult(
  key: string,
  result: StandardSchemaV1.Result<unknown>,
  value: Record<string, unknown>,
  issues: EnvIssue[],
) {
  if (result.issues) {
    issues.push(...result.issues.map((issue) => toEnvIssue(key, issue)));
    return;
  }
  value[key] = result.value;
}

function toEnvIssue(key: string, issue: StandardSchemaV1.Issue): EnvIssue {
  return {
    ...issue,
    variable: key,
    path: [key, ...(issue.path ?? [])],
  };
}

export function normalizeEnv(
  env: EnvSource,
  keys: Iterable<string>,
  options: ParseEnvOptions = {},
): EnvSource {
  const normalizeOptions = { ...DEFAULT_NORMALIZE_OPTIONS, ...options };
  const result: Record<string, unknown> = {};

  for (const key of keys) {
    const rawValue = env[key];
    result[key] = normalizeEnvValue(rawValue, normalizeOptions);
  }

  return result;
}

function normalizeEnvValue(
  value: unknown,
  options: Required<
    Pick<ParseEnvOptions, "trimWhitespace" | "coerceBooleans" | "emptyStringAsUndefined">
  >,
): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = options.trimWhitespace ? value.trim() : value;
  if (options.emptyStringAsUndefined && normalized === "") {
    return undefined;
  }
  if (options.coerceBooleans) {
    const lower = normalized.toLowerCase();
    if (lower === "true") {
      return true;
    }
    if (lower === "false") {
      return false;
    }
  }
  return normalized;
}

function validateEnvConfig(
  server: EnvSchema,
  client: EnvSchema,
  clientPrefix: string | undefined,
): EnvConfigurationError | undefined {
  if (!clientPrefix && Object.keys(client).length > 0) {
    return new EnvConfigurationError(
      "clientPrefix is required when client environment variables are configured.",
    );
  }

  if (!clientPrefix) {
    return undefined;
  }

  for (const key of Object.keys(client)) {
    if (!key.startsWith(clientPrefix)) {
      return new EnvConfigurationError(
        `Client environment variable '${key}' must start with '${clientPrefix}'.`,
      );
    }
  }

  for (const key of Object.keys(server)) {
    if (key.startsWith(clientPrefix)) {
      return new EnvConfigurationError(
        `Server environment variable '${key}' must not start with '${clientPrefix}'.`,
      );
    }
  }

  return undefined;
}

function resolveEnv(env: EnvSource | undefined): Result<EnvSource, EnvConfigurationError> {
  if (env) {
    return ok(env);
  }

  const importMetaEnv = getImportMetaEnv();
  if (!isServerRuntime() && importMetaEnv) {
    return ok(importMetaEnv);
  }

  if (typeof process !== "undefined" && process.env) {
    return ok(process.env);
  }

  if (importMetaEnv) {
    return ok(importMetaEnv);
  }

  return err(
    new EnvConfigurationError(
      "No environment source was provided and 'process.env'/'import.meta.env' are unavailable.",
    ),
  );
}

function getImportMetaEnv(): EnvSource | undefined {
  return (import.meta as ImportMeta & { readonly env?: EnvSource }).env;
}

function isServerRuntime(): boolean {
  return typeof window === "undefined";
}
