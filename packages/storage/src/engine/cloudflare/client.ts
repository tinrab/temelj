import type Cloudflare from "cloudflare";
import type { DatabaseQueryParams, QueryResult } from "cloudflare/resources/d1/database";

type AsyncMethod<TMethod> = TMethod extends (...args: infer TArgs) => PromiseLike<infer TResult>
  ? (...args: TArgs) => Promise<TResult>
  : never;

type IterableMethod<TMethod> = TMethod extends (...args: infer TArgs) => AsyncIterable<infer TItem>
  ? (...args: TArgs) => AsyncIterable<TItem>
  : never;

type KvNamespaces = Cloudflare["kv"]["namespaces"];

type R2Objects = Cloudflare["r2"]["buckets"]["objects"];

/** SDK operations used by the KV engine. */
export interface CloudflareKvClient {
  readonly kv: {
    readonly namespaces: {
      readonly bulkDelete: AsyncMethod<KvNamespaces["bulkDelete"]>;
      readonly bulkGet: AsyncMethod<KvNamespaces["bulkGet"]>;
      readonly bulkUpdate: AsyncMethod<KvNamespaces["bulkUpdate"]>;
      readonly keys: { readonly list: IterableMethod<KvNamespaces["keys"]["list"]> };
      readonly values: {
        readonly delete: AsyncMethod<KvNamespaces["values"]["delete"]>;
        readonly get: AsyncMethod<KvNamespaces["values"]["get"]>;
        readonly update: AsyncMethod<KvNamespaces["values"]["update"]>;
      };
    };
  };
}

/** SDK operations used by the R2 engine. */
export interface CloudflareR2Client {
  readonly r2: {
    readonly buckets: {
      readonly objects: {
        readonly delete: AsyncMethod<R2Objects["delete"]>;
        readonly get: AsyncMethod<R2Objects["get"]>;
        readonly list: IterableMethod<R2Objects["list"]>;
        readonly upload: AsyncMethod<R2Objects["upload"]>;
      };
    };
  };
}

export type CloudflareD1HttpResult = Omit<QueryResult, "results"> & {
  readonly results?: readonly unknown[];
};

/** SDK operations used by the D1 engine. */
export interface CloudflareD1Client {
  readonly d1: {
    readonly database: {
      query(
        databaseId: string,
        params: DatabaseQueryParams.MultipleQueries,
      ): AsyncIterable<CloudflareD1HttpResult>;
    };
  };
}
