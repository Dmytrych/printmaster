import { beforeEach, describe, expect, it } from "vitest";
import {
  FilamentManagementService,
  FilamentMaterial,
  InMemoryFilamentSpoolRepository,
  InsufficientFilamentError,
  InvalidSpoolDataError,
  SpoolNotFoundError,
} from "../src/index.js";

let service: FilamentManagementService;

beforeEach(() => {
  service = new FilamentManagementService(
    new InMemoryFilamentSpoolRepository([
      {
        id: "s1",
        name: "PLA",
        color: "Red",
        material: FilamentMaterial.PLA,
        initialWeight: 1000,
        weight: 300,
      },
    ]),
  );
});

describe("FilamentManagementService", () => {
  it("creates a spool with a generated id, trimmed fields and full weight", async () => {
    const created = await service.create({
      name: "  PETG  ",
      color: " Black ",
      material: FilamentMaterial.PETG,
      initialWeight: 750,
    });

    expect(created).toMatchObject({
      name: "PETG",
      color: "Black",
      initialWeight: 750,
      weight: 750,
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    await expect(service.getById(created.id)).resolves.toEqual(created);
  });

  it("rejects invalid create input", async () => {
    const valid = { name: "PLA", color: "Red", material: FilamentMaterial.PLA, initialWeight: 1 };
    await expect(service.create({ ...valid, name: " " })).rejects.toBeInstanceOf(
      InvalidSpoolDataError,
    );
    await expect(service.create({ ...valid, material: "WOOD" as never })).rejects.toBeInstanceOf(
      InvalidSpoolDataError,
    );
    await expect(service.create({ ...valid, initialWeight: 0 })).rejects.toBeInstanceOf(
      InvalidSpoolDataError,
    );
  });

  it("subtracts weight", async () => {
    await expect(service.subtractWeight("s1", 100)).resolves.toMatchObject({ weight: 200 });
  });

  it("rejects invalid, missing or excessive subtractions without changing the spool", async () => {
    await expect(service.subtractWeight("s1", -5)).rejects.toBeInstanceOf(InvalidSpoolDataError);
    await expect(service.subtractWeight("nope", 5)).rejects.toBeInstanceOf(SpoolNotFoundError);
    await expect(service.subtractWeight("s1", 301)).rejects.toBeInstanceOf(
      InsufficientFilamentError,
    );
    await expect(service.getById("s1")).resolves.toMatchObject({ weight: 300 });
  });

  it("throws SpoolNotFoundError for unknown ids on get and delete", async () => {
    await expect(service.getById("nope")).rejects.toBeInstanceOf(SpoolNotFoundError);
    await expect(service.delete("nope")).rejects.toBeInstanceOf(SpoolNotFoundError);
    await expect(service.delete("s1")).resolves.toBeUndefined();
  });
});
