import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { ApplicationError } from "@printmaster/shared";
import { describe, expect, it } from "vitest";
import {
  ConfigurationError,
  DynamoDbError,
  InvalidCursorError,
  isConditionalCheckFailed,
} from "../src/index.js";

describe("isConditionalCheckFailed", () => {
  it("detects the SDK exception", () => {
    const err = new ConditionalCheckFailedException({ message: "failed", $metadata: {} });
    expect(isConditionalCheckFailed(err)).toBe(true);
  });

  it("detects an object with the matching name (duplicate SDK copies)", () => {
    expect(isConditionalCheckFailed({ name: "ConditionalCheckFailedException" })).toBe(true);
  });

  it("returns false for other errors and non-errors", () => {
    expect(isConditionalCheckFailed(new Error("boom"))).toBe(false);
    expect(isConditionalCheckFailed(null)).toBe(false);
    expect(isConditionalCheckFailed(undefined)).toBe(false);
    expect(isConditionalCheckFailed("ConditionalCheckFailedException")).toBe(false);
  });
});

describe("error hierarchy", () => {
  it("extends ApplicationError with stable codes", () => {
    const config = new ConfigurationError("missing");
    const cursor = new InvalidCursorError();
    for (const err of [config, cursor]) {
      expect(err).toBeInstanceOf(DynamoDbError);
      expect(err).toBeInstanceOf(ApplicationError);
    }
    expect(config.code).toBe("CONFIGURATION_ERROR");
    expect(config.name).toBe("ConfigurationError");
    expect(cursor.code).toBe("INVALID_CURSOR");
  });
});
