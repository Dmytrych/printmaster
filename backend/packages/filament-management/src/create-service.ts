import { getDocumentClient, requireEnv } from "@printmaster/dynamodb";
import { FilamentManagementService } from "./filament-management.service.js";
import { DynamoDbFilamentSpoolRepository } from "./persistence/dynamodb-spool.repository.js";
import { spoolsTable } from "./persistence/tables.js";

/**
 * Composition root for Lambdas: a service backed by DynamoDB.
 * Call it once at module scope so warm invocations reuse the client and a missing
 * table-name env var fails at cold start.
 */
export const createFilamentManagementService = (): FilamentManagementService =>
  new FilamentManagementService(
    new DynamoDbFilamentSpoolRepository(getDocumentClient(), requireEnv(spoolsTable.envVar)),
  );
