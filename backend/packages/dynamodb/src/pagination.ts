import {
  QueryCommand,
  type DynamoDBDocumentClient,
  type NativeAttributeValue,
  type QueryCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { InvalidCursorError } from "./errors.js";

export type Key = Record<string, NativeAttributeValue>;

export type Page<T> = {
  items: T[];
  /** Opaque cursor for the next page; absent when there are no more results. */
  nextCursor?: string;
};

export type PageOptions = {
  limit?: number;
  cursor?: string;
};

/** Encodes a DynamoDB LastEvaluatedKey into an opaque, URL-safe cursor. */
export const encodeCursor = (key?: Key): string | undefined =>
  key ? Buffer.from(JSON.stringify(key), "utf8").toString("base64url") : undefined;

/** Decodes a cursor produced by `encodeCursor`. Throws `InvalidCursorError` on malformed input. */
export const decodeCursor = (cursor?: string): Key | undefined => {
  if (cursor === undefined || cursor === "") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch (cause) {
    throw new InvalidCursorError({ cause });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new InvalidCursorError();
  }
  return parsed as Key;
};

/** Runs a single Query and returns one page of items plus a cursor for the next page. */
export const queryPage = async <T>(
  client: DynamoDBDocumentClient,
  input: QueryCommandInput,
  { limit, cursor }: PageOptions = {},
): Promise<Page<T>> => {
  const exclusiveStartKey = decodeCursor(cursor);
  const result = await client.send(
    new QueryCommand({
      ...input,
      ...(limit === undefined ? {} : { Limit: limit }),
      ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
    }),
  );
  const nextCursor = encodeCursor(result.LastEvaluatedKey);
  return {
    items: (result.Items ?? []) as T[],
    ...(nextCursor ? { nextCursor } : {}),
  };
};

/** Follows LastEvaluatedKey until exhausted. Use only for small, bounded partitions. */
export const queryAll = async <T>(
  client: DynamoDBDocumentClient,
  input: QueryCommandInput,
): Promise<T[]> => {
  const items: T[] = [];
  let exclusiveStartKey: Key | undefined = input.ExclusiveStartKey;
  do {
    const result = await client.send(
      new QueryCommand({ ...input, ExclusiveStartKey: exclusiveStartKey }),
    );
    items.push(...((result.Items ?? []) as T[]));
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return items;
};
