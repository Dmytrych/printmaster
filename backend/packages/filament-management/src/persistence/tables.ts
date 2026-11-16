// Exported as `@printmaster/filament-management/tables` and imported by infra (CDK).
// Keep this file free of runtime imports: type-only imports from "@printmaster/dynamodb/schema" only.
import type { TableDefinition } from "@printmaster/dynamodb/schema";

export const spoolsTable = {
  id: "FilamentSpoolsTable",
  envVar: "FILAMENT_SPOOLS_TABLE_NAME",
  partitionKey: { name: "PK", type: "S" },
  sortKey: { name: "SK", type: "S" },
} as const satisfies TableDefinition;
