import type { Db } from "../db";
import { hasEnrollment } from "./enrollment";

// Placement status (E-35) — the "has this learner been placed?" read the Learn
// first-run entry uses. `placed` is true once the evidence log carries any
// `source:'placement'` row (the seeding ran at least once); `enrolled` once an
// enrollment take exists. Cheap, derived, no model call.

export interface PlacementStatus {
  placed: boolean;
  enrolled: boolean;
}

export function placementStatus(db: Db): PlacementStatus {
  const placed = !!db.prepare("SELECT 1 FROM evidence WHERE source = 'placement' LIMIT 1").get();
  return { placed, enrolled: hasEnrollment(db) };
}
