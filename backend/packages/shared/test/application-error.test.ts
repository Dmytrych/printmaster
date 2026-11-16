import { describe, expect, it } from "vitest";
import { ApplicationError } from "../src/index.js";

class SampleError extends ApplicationError {
  public constructor(options?: ErrorOptions) {
    super("SAMPLE", "sample message", options);
  }
}

describe("ApplicationError", () => {
  it("is an instance of Error and ApplicationError", () => {
    const err = new ApplicationError("CODE", "message");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApplicationError);
  });

  it("sets code, message and cause", () => {
    const cause = new Error("root");
    const err = new ApplicationError("CODE", "message", { cause });
    expect(err.code).toBe("CODE");
    expect(err.message).toBe("message");
    expect(err.cause).toBe(cause);
  });

  it("uses the subclass name", () => {
    const err = new SampleError();
    expect(err.name).toBe("SampleError");
    expect(err).toBeInstanceOf(ApplicationError);
    expect(err.code).toBe("SAMPLE");
  });
});
