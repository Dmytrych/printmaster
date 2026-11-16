import { FilamentMaterial } from "./filament-material.type.js";

export type FilamentSpool = {
  id: string;
  name: string;
  color: string;
  material: FilamentMaterial;
  /** Weight (grams) the spool had when it was created. Never changes. */
  readonly initialWeight: number;
  /** Current remaining weight (grams). */
  weight: number;
};

export type CreateFilamentSpoolInput = {
  name: string;
  color: string;
  material: FilamentMaterial;
  initialWeight: number;
};
