import type { FilamentSpool } from "../types/filament-spool.type.js";

/**
 * Persisted shape of a spool in the spools table.
 *
 * Access patterns: get / delete / update by id, and list all spools.
 * All spools share one partition, so listing is a single Query (no Scan, no GSI).
 * When users are introduced, the partition becomes `USER#<userId>`.
 */
export const SPOOLS_PARTITION = "SPOOLS";
export const SPOOL_ENTITY_TYPE = "Spool";

export type SpoolKey = {
  PK: typeof SPOOLS_PARTITION;
  SK: `SPOOL#${string}`;
};

export type SpoolItem = FilamentSpool & SpoolKey & { entityType: typeof SPOOL_ENTITY_TYPE };

export const spoolKey = (id: string): SpoolKey => ({ PK: SPOOLS_PARTITION, SK: `SPOOL#${id}` });

export const toSpoolItem = (spool: FilamentSpool): SpoolItem => ({
  ...spool,
  ...spoolKey(spool.id),
  entityType: SPOOL_ENTITY_TYPE,
});

export const fromSpoolItem = (item: SpoolItem): FilamentSpool => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { PK, SK, entityType, ...spool } = item;
  return spool;
};
