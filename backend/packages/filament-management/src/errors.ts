import { ApplicationError } from "@printmaster/shared";

/** Base class for filament-management domain errors. */
export class FilamentManagementError extends ApplicationError {}

export class SpoolNotFoundError extends FilamentManagementError {
  public constructor(id: string) {
    super("SPOOL_NOT_FOUND", `Spool with id "${id}" was not found`);
  }
}

export class InvalidSpoolDataError extends FilamentManagementError {
  public constructor(message: string) {
    super("INVALID_SPOOL_DATA", message);
  }
}

export class InsufficientFilamentError extends FilamentManagementError {
  public constructor(id: string, available: number, requested: number) {
    super(
      "INSUFFICIENT_FILAMENT",
      `Spool "${id}" has ${available}g left, cannot subtract ${requested}g`,
    );
  }
}
