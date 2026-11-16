import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { createDocumentClient } from "@printmaster/dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DynamoDbFilamentSpoolRepository,
  FilamentMaterial,
  InsufficientFilamentError,
  SpoolNotFoundError,
  type FilamentSpool,
} from "../src/index.js";
import { toSpoolItem } from "../src/persistence/spool.item.js";

const TABLE = "spools-test";
const ddbMock = mockClient(DynamoDBDocumentClient);
const repo = new DynamoDbFilamentSpoolRepository(
  createDocumentClient({ region: "eu-central-1" }),
  TABLE,
);

const spool: FilamentSpool = {
  id: "abc",
  name: "PLA Spool",
  color: "Red",
  material: FilamentMaterial.PLA,
  initialWeight: 1000,
  weight: 640,
};

const conditionalCheckFailed = () =>
  Object.assign(new Error("The conditional request failed"), {
    name: "ConditionalCheckFailedException",
  });

beforeEach(() => {
  ddbMock.reset();
});

describe("DynamoDbFilamentSpoolRepository", () => {
  it("findAll queries the spools partition and strips storage attributes", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [toSpoolItem(spool)] });

    await expect(repo.findAll()).resolves.toEqual([spool]);

    expect(ddbMock.commandCalls(QueryCommand)[0]?.args[0].input).toMatchObject({
      TableName: TABLE,
      KeyConditionExpression: "#pk = :pk",
      ExpressionAttributeNames: { "#pk": "PK" },
      ExpressionAttributeValues: { ":pk": "SPOOLS" },
    });
  });

  it("findById gets by key and maps the item", async () => {
    ddbMock.on(GetCommand).resolves({ Item: toSpoolItem(spool) });

    await expect(repo.findById("abc")).resolves.toEqual(spool);
    expect(ddbMock.commandCalls(GetCommand)[0]?.args[0].input).toEqual({
      TableName: TABLE,
      Key: { PK: "SPOOLS", SK: "SPOOL#abc" },
    });
  });

  it("findById returns null when the item is missing", async () => {
    ddbMock.on(GetCommand).resolves({});
    await expect(repo.findById("missing")).resolves.toBeNull();
  });

  it("create puts the item without overwriting an existing one", async () => {
    ddbMock.on(PutCommand).resolves({});

    await expect(repo.create(spool)).resolves.toEqual(spool);
    expect(ddbMock.commandCalls(PutCommand)[0]?.args[0].input).toEqual({
      TableName: TABLE,
      Item: toSpoolItem(spool),
      ConditionExpression: "attribute_not_exists(#pk)",
      ExpressionAttributeNames: { "#pk": "PK" },
    });
  });

  it("subtractWeight runs one conditional update and returns the new state", async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: toSpoolItem({ ...spool, weight: 600 }) });

    await expect(repo.subtractWeight("abc", 40)).resolves.toEqual({ ...spool, weight: 600 });
    expect(ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input).toMatchObject({
      TableName: TABLE,
      Key: { PK: "SPOOLS", SK: "SPOOL#abc" },
      UpdateExpression: "SET #weight = #weight - :amount",
      ConditionExpression: "attribute_exists(#pk) AND #weight >= :amount",
      ExpressionAttributeValues: { ":amount": 40 },
      ReturnValues: "ALL_NEW",
    });
  });

  it("subtractWeight throws SpoolNotFoundError when the spool does not exist", async () => {
    ddbMock.on(UpdateCommand).rejects(conditionalCheckFailed());
    ddbMock.on(GetCommand).resolves({});

    await expect(repo.subtractWeight("missing", 10)).rejects.toBeInstanceOf(SpoolNotFoundError);
  });

  it("subtractWeight throws InsufficientFilamentError with the current weight", async () => {
    ddbMock.on(UpdateCommand).rejects(conditionalCheckFailed());
    ddbMock.on(GetCommand).resolves({ Item: toSpoolItem(spool) });

    const err = await repo.subtractWeight("abc", 700).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InsufficientFilamentError);
    expect((err as Error).message).toContain("640g left");
  });

  it("subtractWeight rethrows other errors unchanged", async () => {
    const boom = new Error("throttled");
    ddbMock.on(UpdateCommand).rejects(boom);

    await expect(repo.subtractWeight("abc", 10)).rejects.toBe(boom);
    expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
  });

  it("deleteById reports whether an item was removed", async () => {
    ddbMock
      .on(DeleteCommand)
      .resolvesOnce({ Attributes: toSpoolItem(spool) })
      .resolvesOnce({});

    await expect(repo.deleteById("abc")).resolves.toBe(true);
    await expect(repo.deleteById("abc")).resolves.toBe(false);
    expect(ddbMock.commandCalls(DeleteCommand)[0]?.args[0].input).toMatchObject({
      Key: { PK: "SPOOLS", SK: "SPOOL#abc" },
      ReturnValues: "ALL_OLD",
    });
  });
});
