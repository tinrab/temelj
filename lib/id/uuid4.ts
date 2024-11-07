import id128 from "id128";

export function generateUuid4(): string {
  return id128.Uuid4.generate().toCanonical().toLowerCase();
}

export function isUuid4Valid(id: string): boolean {
  try {
    return !!id128.Uuid4.fromCanonical(id);
  } catch {
    return false;
  }
}

export function getUuid4Bytes(id: string): Uint8Array {
  const uuid = id128.Uuid4.fromCanonicalTrusted(id);
  return uuid.bytes;
}

export function makeUuid4FromBytes(bytes: Uint8Array): string {
  return id128.Uuid4.construct(bytes).toCanonical().toLowerCase();
}
