import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { beforeAll, describe, expect, it, vi } from "vitest";

const ddbMock = mockClient(DynamoDBDocumentClient);

// The service is built at module scope, so env and mocks must exist before importing the handler.
let handler: typeof import("../src/index.js").handler;
beforeAll(async () => {
  vi.stubEnv("FILAMENT_SPOOLS_TABLE_NAME", "spools-test");
  vi.stubEnv("AWS_REGION", "eu-central-1");
  ({ handler } = await import("../src/index.js"));
});

describe("handler", () => {
  it("returns the spools from DynamoDB as JSON", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        {
          PK: "SPOOLS",
          SK: "SPOOL#1",
          entityType: "Spool",
          id: "1",
          name: "PLA Spool",
          color: "Red",
          material: "PLA",
          initialWeight: 1000,
          weight: 1000,
        },
      ],
    });

    const result = await handler();

    expect(result).toMatchObject({
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
    });
    const body = JSON.parse((result as { body: string }).body) as { data: unknown[] };
    expect(body.data).toEqual([
      {
        id: "1",
        name: "PLA Spool",
        color: "Red",
        material: "PLA",
        initialWeight: 1000,
        weight: 1000,
      },
    ]);
    expect(ddbMock.commandCalls(QueryCommand)[0]?.args[0].input.TableName).toBe("spools-test");
  });
});
