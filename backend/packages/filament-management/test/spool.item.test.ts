import { describe, expect, it } from "vitest";
import { fromSpoolItem, spoolKey, toSpoolItem } from "../src/persistence/spool.item.js";
import { spoolsTable } from "../src/persistence/tables.js";
import { FilamentMaterial, type FilamentSpool } from "../src/index.js";

const spool: FilamentSpool = {
  id: "abc-123",
  name: "PLA Spool",
  color: "Red",
  material: FilamentMaterial.PLA,
  initialWeight: 1000,
  weight: 640,
};

describe("spool item schema", () => {
  it("builds type-prefixed keys in the shared spools partition", () => {
    expect(spoolKey("abc-123")).toEqual({ PK: "SPOOLS", SK: "SPOOL#abc-123" });
  });

  it("uses the key attribute names declared by the table definition", () => {
    const item = toSpoolItem(spool);
    expect(item).toHaveProperty(spoolsTable.partitionKey.name, "SPOOLS");
    expect(item).toHaveProperty(spoolsTable.sortKey.name, "SPOOL#abc-123");
  });

  it("adds keys and entityType when persisting", () => {
    expect(toSpoolItem(spool)).toEqual({
      ...spool,
      PK: "SPOOLS",
      SK: "SPOOL#abc-123",
      entityType: "Spool",
    });
  });

  it("round-trips back to the domain type without storage attributes", () => {
    expect(fromSpoolItem(toSpoolItem(spool))).toEqual(spool);
  });
});
