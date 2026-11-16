import { DynamoDBClient, type DynamoDBClientConfig } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

/**
 * Creates a DocumentClient with project-wide marshalling defaults.
 * `DYNAMODB_ENDPOINT` (if set) points it at DynamoDB Local; region comes from the SDK default chain.
 */
export const createDocumentClient = (config: DynamoDBClientConfig = {}): DynamoDBDocumentClient => {
  const endpoint = process.env.DYNAMODB_ENDPOINT;
  const client = new DynamoDBClient({ ...(endpoint ? { endpoint } : {}), ...config });
  return DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });
};

let documentClient: DynamoDBDocumentClient | undefined;

/** Module-level singleton, so warm Lambda invocations reuse connections. */
export const getDocumentClient = (): DynamoDBDocumentClient =>
  (documentClient ??= createDocumentClient());
