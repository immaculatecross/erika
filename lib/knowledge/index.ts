// The knowledge core (E-25, D-19): the append-only evidence log and the per-item
// knowledge state derived from it. This barrel is the public surface — features
// import from `@/lib/knowledge`, not the sub-modules. Split across items / evidence
// / derive under the 500-line hook; types and the mode/weight constants are
// client-safe (no I/O), the rest is server-only DB glue.

export * from "./types";
export {
  UnvalidatedLemmaError,
  lemmaItemId,
  ruleItemId,
  phoneItemId,
  parseItemId,
  getItem,
  listItems,
  ensureLemmaItem,
  ensureRuleItem,
  ensurePhoneItem,
  itemExists,
} from "./items";
export { recordEvidence, bridgeFinding, getEvidence } from "./evidence";
export {
  evidenceToGrade,
  deriveStatus,
  deriveRecordingAttested,
  deriveItemState,
  itemEvidence,
  rebuildItem,
  rebuildAllDerived,
  type DerivedState,
} from "./derive";
