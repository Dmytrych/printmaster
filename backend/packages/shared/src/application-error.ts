/**
 * Base class for every custom error in PrintMaster.
 * `code` is a stable, machine-readable identifier; pass `{ cause }` when wrapping another error.
 */
export class ApplicationError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}
