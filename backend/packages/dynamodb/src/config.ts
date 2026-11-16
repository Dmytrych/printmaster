import { ConfigurationError } from "./errors.js";

/** Reads a required environment variable (e.g. a table name). Throws if missing or empty. */
export const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new ConfigurationError(`Environment variable "${name}" is required`);
  }
  return value;
};
