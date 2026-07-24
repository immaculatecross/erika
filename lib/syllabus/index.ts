// The grammar syllabus (E-26b, D-19): the barrel. Features import from
// `@/lib/syllabus`, not the sub-modules. Split across types / load / validate under
// the 500-line hook; the rule inventory itself is the versioned `grammar-it.json`.

export * from "./types";
export { loadSyllabus, SyllabusShapeError, _resetSyllabusCache } from "./load";
export {
  validateSyllabus,
  topoSort,
  cefrHistogram,
  type ValidationError,
  type ValidationResult,
} from "./validate";
