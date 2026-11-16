import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import {
  FilamentManagementError,
  InsufficientFilamentError,
  InvalidSpoolDataError,
  SpoolNotFoundError,
} from "@printmaster/filament-management";
import { ApplicationError } from "@printmaster/shared";

type Result = Exclude<APIGatewayProxyResultV2, string>;

export class BadRequestError extends ApplicationError {
  public constructor(message: string, options?: ErrorOptions) {
    super("BAD_REQUEST", message, options);
  }
}

export const json = (statusCode: number, body?: unknown): Result => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const parseJsonBody = (event: APIGatewayProxyEventV2): Record<string, unknown> => {
  if (!event.body) throw new BadRequestError("Request body is required");
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequestError("Request body must be valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new BadRequestError("Request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
};

export const getPathId = (event: APIGatewayProxyEventV2): string => {
  const id = event.pathParameters?.id;
  if (!id) throw new BadRequestError("Path parameter 'id' is required");
  return id;
};

const errorResponse = (status: number, code: string, message: string): Result =>
  json(status, { error: { code, message } });

export const handleError = (err: unknown): Result => {
  if (err instanceof BadRequestError) return errorResponse(400, err.code, err.message);
  if (err instanceof SpoolNotFoundError) return errorResponse(404, err.code, err.message);
  if (err instanceof InvalidSpoolDataError) return errorResponse(400, err.code, err.message);
  if (err instanceof InsufficientFilamentError) return errorResponse(409, err.code, err.message);
  if (err instanceof FilamentManagementError) return errorResponse(500, err.code, err.message);
  console.error("Unhandled error", err);
  return errorResponse(500, "INTERNAL_ERROR", "Internal server error");
};

/** Wraps a handler body so any thrown error becomes a proper HTTP response. */
export const withErrorHandling =
  (fn: (event: APIGatewayProxyEventV2) => Promise<Result>) =>
  async (event: APIGatewayProxyEventV2): Promise<Result> => {
    try {
      return await fn(event);
    } catch (err) {
      return handleError(err);
    }
  };
