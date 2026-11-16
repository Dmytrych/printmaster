import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vitest";
import { getDocumentClient } from "../src/index.js";

describe("getDocumentClient", () => {
  it("returns the same DocumentClient instance on every call", () => {
    const first = getDocumentClient();
    expect(first).toBeInstanceOf(DynamoDBDocumentClient);
    expect(getDocumentClient()).toBe(first);
  });
});
