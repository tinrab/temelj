import type { ClientOptions } from "cloudflare";

import type { StorageEngineSetOptions } from "../../types.ts";

/**
 * Worker environment bindings map used to resolve bindings by name.
 */
export type CloudflareBindings = { readonly [name: string]: unknown };

export function cloudflareClientOptions(options: ClientOptions): ClientOptions {
  return {
    apiEmail: options.apiEmail,
    apiKey: options.apiKey,
    apiToken: options.apiToken,
    apiVersion: options.apiVersion,
    baseURL: options.baseURL,
    defaultHeaders: options.defaultHeaders,
    defaultQuery: options.defaultQuery,
    fetch: options.fetch,
    maxRetries: options.maxRetries,
    timeout: options.timeout,
    userServiceKey: options.userServiceKey,
  };
}

export function isCloudflareNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { readonly status?: unknown }).status === 404
  );
}

export function resolveCloudflareBinding<TBinding>(
  binding: TBinding | string | undefined,
  bindings: CloudflareBindings | undefined,
  kind: string,
  isBinding: (value: unknown) => value is TBinding,
): TBinding | undefined {
  if (binding === undefined) {
    return undefined;
  }
  if (typeof binding !== "string") {
    return binding;
  }

  const resolved = bindings?.[binding];
  if (resolved === undefined) {
    throw new TypeError(`Cloudflare binding ${binding} was not found`);
  }
  if (!isBinding(resolved)) {
    throw new TypeError(`Cloudflare binding ${binding} is not a ${kind} binding`);
  }
  return resolved;
}

export function resolveCloudflareExpiresAt(
  options: StorageEngineSetOptions | undefined,
  defaultTtl: number | undefined,
  now = Date.now(),
): number | undefined {
  const ttl = options?.ttl ?? defaultTtl;
  return ttl === undefined ? undefined : now + ttl;
}
