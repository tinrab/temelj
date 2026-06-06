import type { Result } from "@temelj/result";

import { ss } from "@temelj/standard-schema";

import type { EnvError, EnvSource, ParseEnvOptions } from "./types";

import { parseEnv, tryParseEnv } from "./parse";

export interface ViteEnv {
  readonly BASE_URL: string;
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly SSR: boolean;
}

const viteSchema = {
  BASE_URL: ss.string(),
  MODE: ss.string(),
  DEV: ss.boolean(),
  PROD: ss.boolean(),
  SSR: ss.boolean(),
};

/**
 * Vite built-in environment variables.
 *
 * @see https://vite.dev/guide/env-and-mode
 */
export function parseViteEnv(options: ParseEnvOptions = {}): Readonly<ViteEnv> {
  return parseEnv(viteSchema, {
    ...options,
    env: options.env ?? getImportMetaEnv(),
  });
}

/**
 * Vite built-in environment variables as a Result.
 *
 * @see https://vite.dev/guide/env-and-mode
 */
export function tryParseViteEnv(
  options: ParseEnvOptions = {},
): Result<Readonly<ViteEnv>, EnvError> {
  return tryParseEnv(viteSchema, {
    ...options,
    env: options.env ?? getImportMetaEnv(),
  });
}

function getImportMetaEnv(): EnvSource | undefined {
  return (import.meta as ImportMeta & { readonly env?: EnvSource }).env;
}
