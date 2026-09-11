import { omitUndefined, type DefinedProperties } from "../collection.ts";

/** Removes undefined optional fields before persisting a workflow store record. */
export function compactWorkflowStoreRecord<TRecord extends object>(
  record: TRecord,
): DefinedProperties<TRecord> {
  return omitUndefined(record);
}
