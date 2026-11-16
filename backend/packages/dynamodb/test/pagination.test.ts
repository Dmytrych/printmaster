import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createDocumentClient,
  decodeCursor,
  encodeCursor,
  InvalidCursorError,
  queryAll,
  queryPage,
} from "../src/index.js";

const ddbMock = mockClient(DynamoDBDocumentClient);
const client = createDocumentClient({ region: "us-east-1" });
const baseInput = {
  TableName: "spools",
  KeyConditionExpression: "PK = :pk",
  ExpressionAttributeValues: { ":pk": "SPOOL" },
};

beforeEach(() => {
  ddbMock.reset();
});

describe("cursor", () => {
  it("round-trips a key", () => {
    const key = { PK: "SPOOL", SK: "abc", n: 5 };
    expect(decodeCursor(encodeCursor(key))).toEqual(key);
  });

  it("returns undefined for no key / no cursor", () => {
    expect(encodeCursor(undefined)).toBeUndefined();
    expect(decodeCursor(undefined)).toBeUndefined();
    expect(decodeCursor("")).toBeUndefined();
  });

  it("produces URL-safe output", () => {
    const cursor = encodeCursor({ PK: "???>>>", SK: "~~~" });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects malformed cursors", () => {
    expect(() => decodeCursor("not-json!!")).toThrow(InvalidCursorError);
  });

  it("rejects cursors that are not plain objects", () => {
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
    expect(() => decodeCursor(encode([1, 2]))).toThrow(InvalidCursorError);
    expect(() => decodeCursor(encode("str"))).toThrow(InvalidCursorError);
    expect(() => decodeCursor(encode(null))).toThrow(InvalidCursorError);
  });
});

describe("queryPage", () => {
  it("passes Limit and ExclusiveStartKey and encodes nextCursor", async () => {
    const startKey = { PK: "SPOOL", SK: "1" };
    const lastKey = { PK: "SPOOL", SK: "3" };
    ddbMock
      .on(QueryCommand)
      .resolves({ Items: [{ SK: "2" }, { SK: "3" }], LastEvaluatedKey: lastKey });

    const page = await queryPage<{ SK: string }>(client, baseInput, {
      limit: 2,
      cursor: encodeCursor(startKey),
    });

    const sent = ddbMock.commandCalls(QueryCommand)[0]?.args[0].input;
    expect(sent).toMatchObject({ ...baseInput, Limit: 2, ExclusiveStartKey: startKey });
    expect(page.items).toEqual([{ SK: "2" }, { SK: "3" }]);
    expect(decodeCursor(page.nextCursor)).toEqual(lastKey);
  });

  it("omits nextCursor on the last page and handles missing Items", async () => {
    ddbMock.on(QueryCommand).resolves({});

    const page = await queryPage(client, baseInput);

    const sent = ddbMock.commandCalls(QueryCommand)[0]?.args[0].input;
    expect(sent).not.toHaveProperty("Limit");
    expect(sent).not.toHaveProperty("ExclusiveStartKey");
    expect(page).toEqual({ items: [] });
  });
});

describe("queryAll", () => {
  it("follows LastEvaluatedKey and concatenates pages", async () => {
    const k1 = { PK: "SPOOL", SK: "1" };
    const k2 = { PK: "SPOOL", SK: "2" };
    ddbMock
      .on(QueryCommand)
      .resolvesOnce({ Items: [{ SK: "1" }], LastEvaluatedKey: k1 })
      .resolvesOnce({ Items: [{ SK: "2" }], LastEvaluatedKey: k2 })
      .resolvesOnce({ Items: [{ SK: "3" }] });

    const items = await queryAll(client, baseInput);

    const calls = ddbMock.commandCalls(QueryCommand).map((c) => c.args[0].input.ExclusiveStartKey);
    expect(calls).toEqual([undefined, k1, k2]);
    expect(items).toEqual([{ SK: "1" }, { SK: "2" }, { SK: "3" }]);
  });
});
