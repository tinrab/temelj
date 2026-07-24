import { omitUndefined } from "../collection.ts";

/** Removes undefined optional fields before persisting a workflow store record. */
export function compactWorkflowStoreRecord<TRecord extends object>(record: TRecord): TRecord {
  return omitUndefined(record) as TRecord;
}
