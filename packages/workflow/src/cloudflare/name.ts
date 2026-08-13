const CLOUDFLARE_NAME_CHARACTERS = /[^a-zA-Z0-9_-]+/g;

export function makeCloudflareWorkflowStepName(value: string): string {
  return makeCloudflareName(value, 256, "step");
}

export function makeCloudflareWorkflowEventType(value: string): string {
  return makeCloudflareName(value, 100, "event");
}

function makeCloudflareName(value: string, maximumLength: number, fallback: string): string {
  const normalized = value.replace(CLOUDFLARE_NAME_CHARACTERS, "-").replace(/^-+/, "");
  const prefix = (normalized === "" ? fallback : normalized).slice(0, maximumLength - 16);
  return `${prefix}-${fnv1a(value)}`.slice(0, maximumLength);
}

function fnv1a(value: string): string {
  let hash = 0xcbf2_9ce4_8422_2325n;
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x01_00_00_00_01_b3n);
  }
  return hash.toString(36).padStart(13, "0");
}
