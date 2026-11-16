import { InsufficientFilamentError, SpoolNotFoundError } from "./errors.js";
import { FilamentMaterial } from "./types/filament-material.type.js";
import type { FilamentSpool } from "./types/filament-spool.type.js";

export interface FilamentSpoolRepository {
  findAll(): Promise<FilamentSpool[]>;
  findById(id: string): Promise<FilamentSpool | null>;
  /** Inserts a new spool. */
  create(spool: FilamentSpool): Promise<FilamentSpool>;
  /**
   * Atomically subtracts `amount` grams and returns the updated spool.
   * Throws SpoolNotFoundError or InsufficientFilamentError (spool left unchanged).
   */
  subtractWeight(id: string, amount: number): Promise<FilamentSpool>;
  /** Returns true if a spool was removed. */
  deleteById(id: string): Promise<boolean>;
}

export const seedSpools = (): FilamentSpool[] => [
  {
    id: "1",
    name: "PLA Spool",
    color: "Red",
    material: FilamentMaterial.PLA,
    initialWeight: 1000,
    weight: 1000,
  },
  {
    id: "2",
    name: "PETG Spool",
    color: "Black",
    material: FilamentMaterial.PETG,
    initialWeight: 1000,
    weight: 640,
  },
  {
    id: "3",
    name: "ABS Spool",
    color: "White",
    material: FilamentMaterial.ABS,
    initialWeight: 750,
    weight: 120,
  },
];

/** In-memory implementation for tests and local experiments. */
export class InMemoryFilamentSpoolRepository implements FilamentSpoolRepository {
  private readonly spools = new Map<string, FilamentSpool>();

  public constructor(initial: FilamentSpool[] = seedSpools()) {
    for (const spool of initial) this.spools.set(spool.id, { ...spool });
  }

  public async findAll(): Promise<FilamentSpool[]> {
    return [...this.spools.values()].map((s) => ({ ...s }));
  }

  public async findById(id: string): Promise<FilamentSpool | null> {
    const spool = this.spools.get(id);
    return spool ? { ...spool } : null;
  }

  public async create(spool: FilamentSpool): Promise<FilamentSpool> {
    this.spools.set(spool.id, { ...spool });
    return { ...spool };
  }

  public async subtractWeight(id: string, amount: number): Promise<FilamentSpool> {
    const spool = this.spools.get(id);
    if (!spool) throw new SpoolNotFoundError(id);
    if (amount > spool.weight) throw new InsufficientFilamentError(id, spool.weight, amount);
    const updated = { ...spool, weight: spool.weight - amount };
    this.spools.set(id, updated);
    return { ...updated };
  }

  public async deleteById(id: string): Promise<boolean> {
    return this.spools.delete(id);
  }
}
