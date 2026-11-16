import { ApplicationError } from "@printmaster/shared";

/** Base class for errors raised by the DynamoDB infrastructure package. */
export class DynamoDbError extends ApplicationError {}

export class ConfigurationError extends DynamoDbError {
  public constructor(message: string, options?: ErrorOptions) {
    super("CONFIGURATION_ERROR", message, options);
  }
}

export class InvalidCursorError extends DynamoDbError {
  public constructor(options?: ErrorOptions) {
    super("INVALID_CURSOR", "Pagination cursor is invalid", options);
  }
}

/**
 * True if `err` is a DynamoDB ConditionalCheckFailedException.
 * Matches by name rather than `instanceof` so it works across duplicate SDK copies.
 */
export const isConditionalCheckFailed = (err: unknown): boolean =>
  typeof err === "object" &&
  err !== null &&
  (err as { name?: unknown }).name === "ConditionalCheckFailedException";
