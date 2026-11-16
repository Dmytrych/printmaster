import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigurationError, requireEnv } from "../src/index.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("requireEnv", () => {
  it("returns the value when set", () => {
    vi.stubEnv("SPOOLS_TABLE_NAME", "spools-dev");
    expect(requireEnv("SPOOLS_TABLE_NAME")).toBe("spools-dev");
  });

  it("throws ConfigurationError when missing", () => {
    vi.stubEnv("SPOOLS_TABLE_NAME", undefined);
    expect(() => requireEnv("SPOOLS_TABLE_NAME")).toThrow(ConfigurationError);
  });

  it("throws ConfigurationError when empty or blank", () => {
    vi.stubEnv("SPOOLS_TABLE_NAME", "  ");
    expect(() => requireEnv("SPOOLS_TABLE_NAME")).toThrow(ConfigurationError);
  });
});
