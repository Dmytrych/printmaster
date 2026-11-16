import { randomUUID } from "node:crypto";
import { InvalidSpoolDataError, SpoolNotFoundError } from "./errors.js";
import type { FilamentSpoolRepository } from "./filament-management.repository.js";
import { FilamentMaterial } from "./types/filament-material.type.js";
import type { CreateFilamentSpoolInput, FilamentSpool } from "./types/filament-spool.type.js";

const isPositiveNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

export class FilamentManagementService {
  /** Use `createFilamentManagementService()` in Lambdas; pass a repository directly in tests. */
  public constructor(private readonly repository: FilamentSpoolRepository) {}

  public async getAll(): Promise<FilamentSpool[]> {
    return this.repository.findAll();
  }

  public async getById(id: string): Promise<FilamentSpool> {
    const spool = await this.repository.findById(id);
    if (!spool) throw new SpoolNotFoundError(id);
    return spool;
  }

  public async create(input: CreateFilamentSpoolInput): Promise<FilamentSpool> {
    if (!isNonEmptyString(input?.name)) throw new InvalidSpoolDataError("name is required");
    if (!isNonEmptyString(input.color)) throw new InvalidSpoolDataError("color is required");
    if (!Object.values(FilamentMaterial).includes(input.material)) {
      throw new InvalidSpoolDataError(
        `material must be one of: ${Object.values(FilamentMaterial).join(", ")}`,
      );
    }
    if (!isPositiveNumber(input.initialWeight)) {
      throw new InvalidSpoolDataError("initialWeight must be a number greater than 0");
    }

    return this.repository.create({
      id: randomUUID(),
      name: input.name.trim(),
      color: input.color.trim(),
      material: input.material,
      initialWeight: input.initialWeight,
      weight: input.initialWeight,
    });
  }

  public async delete(id: string): Promise<void> {
    const removed = await this.repository.deleteById(id);
    if (!removed) throw new SpoolNotFoundError(id);
  }

  /**
   * Subtracts used filament. Rejects (without changing the spool) if it would go below zero.
   * The check-and-write is atomic in the repository, so concurrent requests can't lose updates.
   */
  public async subtractWeight(id: string, amount: number): Promise<FilamentSpool> {
    if (!isPositiveNumber(amount)) {
      throw new InvalidSpoolDataError("amount must be a number greater than 0");
    }
    return this.repository.subtractWeight(id, amount);
  }
}
