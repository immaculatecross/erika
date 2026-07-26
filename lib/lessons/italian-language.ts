import type { ItemLesson } from "./item-lessons-view";
import { TextModelParseError } from "./text-model";

// A bounded, deterministic language gate for lesson content. This is deliberately
// narrower than a general-purpose language detector: it distinguishes the failure
// modes that matter here (English and materially mixed prose) while allowing short
// Italian grammar forms such as "gli", "c'è" and "avrei", which statistical
// detectors routinely misclassify.
//
// Honest limit: a one-to-five-token string with no recognised English word is
// accepted. There is not enough evidence to identify an arbitrary short token's
// language without a dictionary, and rejecting valid conjugations would make the
// generated exercises unusable. The lesson-wide gate still requires every longer
// prose field to carry positive Italian evidence.

const MAX_FIELDS = 96;
const MAX_TOKENS_PER_FIELD = 256;

const ENGLISH_WORDS = new Set([
  "the", "this", "that", "these", "those", "which", "what", "when", "where", "why", "how",
  "and", "or", "but", "because", "although", "while", "with", "without", "from", "into",
  "before", "after", "between", "through", "during", "about", "for", "of", "to", "by",
  "is", "are", "was", "were", "be", "been", "being", "has", "have", "had", "does", "do",
  "use", "uses", "used", "using", "take", "takes", "choose", "pick", "select", "answer",
  "correct", "incorrect", "word", "words", "sentence", "sentences", "means", "meaning",
  "house", "home", "book", "example", "examples", "rule", "subject", "object", "verb",
  "noun", "adjective", "adverb", "present", "past", "future", "singular", "plural",
  "soft", "hard", "age",
  "first", "second", "third", "always", "usually", "never", "only", "also", "very",
  "your", "you", "they", "their", "we", "our", "he", "she", "his", "her", "it", "its",
]);

const ITALIAN_WORDS = new Set([
  "il", "lo", "la", "i", "gli", "le", "un", "uno", "una", "del", "dello", "della", "dei",
  "degli", "delle", "al", "allo", "alla", "ai", "agli", "alle", "nel", "nello", "nella",
  "di", "da", "con", "su", "per", "tra", "fra", "e", "o", "ma", "perché", "che", "cui",
  "chi", "come", "quando", "dove", "quanto", "quale", "se", "non", "più", "meno", "molto",
  "poco", "sempre", "spesso", "mai", "già", "ancora", "anche", "solo", "ogni", "tutto",
  "questo", "questa", "quello", "quella", "stesso", "stessa", "altro", "altra", "si",
  "ci", "ne", "mi", "ti", "vi", "sono", "sei", "è", "siamo", "siete", "era", "hanno",
  "ha", "ho", "hai", "avere", "essere", "usa", "usano", "usare", "indica", "esprime",
  "forma", "forme", "frase", "frasi", "parola", "parole", "verbo", "verbi", "nome",
  "nomi", "aggettivo", "avverbio", "pronome", "articolo", "singolare", "plurale",
  "presente", "passato", "futuro", "corretto", "corretta", "corretti", "corrette",
  "scegli", "completa", "risposta", "regola", "esempio", "esempi", "significa",
]);

const ITALIAN_SUFFIXES = [
  "zione", "zioni", "mente", "ando", "endo", "ato", "ata", "ati", "ate", "ito", "ita",
  "ivo", "iva", "ivi", "ive", "oso", "osa", "osi", "ose", "are", "ere", "ire", "iamo",
  "ano", "ono", "ino", "ina", "ini", "ine", "ale", "ali", "ente", "enti", "ità",
];

function tokensOf(text: string): string[] {
  return text
    .toLocaleLowerCase("it")
    .match(/\p{L}+(?:['’]\p{L}+)?/gu)
    ?.slice(0, MAX_TOKENS_PER_FIELD) ?? [];
}

function positiveItalianSignal(token: string): boolean {
  if (ITALIAN_WORDS.has(token)) return true;
  if (/[àèéìòù]/u.test(token)) return true;
  return token.length >= 5 && ITALIAN_SUFFIXES.some((suffix) => token.endsWith(suffix));
}

export interface ItalianTextResult {
  valid: boolean;
  reason: "empty" | "english" | "mixed" | "no-italian-signal" | null;
  tokenCount: number;
}

export function validateItalianText(text: string): ItalianTextResult {
  const tokens = tokensOf(text.trim());
  if (tokens.length === 0) return { valid: false, reason: "empty", tokenCount: 0 };

  const english = tokens.filter((token) => ENGLISH_WORDS.has(token)).length;
  const italian = tokens.filter(positiveItalianSignal).length;

  // Short grammar tokens cannot be judged statistically. We still reject explicit
  // English ("choose", "answer", "house"), which catches the dangerous direction.
  if (tokens.length <= 5) {
    return {
      valid: english === 0,
      reason: english === 0 ? null : "english",
      tokenCount: tokens.length,
    };
  }

  if (english >= 2 && italian === 0) {
    return { valid: false, reason: "english", tokenCount: tokens.length };
  }
  if (english >= 2 && (english / tokens.length >= 0.12 || english >= italian)) {
    return { valid: false, reason: "mixed", tokenCount: tokens.length };
  }

  const minimumItalianSignals = tokens.length >= 12 ? 2 : 1;
  if (italian < minimumItalianSignals) {
    return { valid: false, reason: "no-italian-signal", tokenCount: tokens.length };
  }
  return { valid: true, reason: null, tokenCount: tokens.length };
}

export class ItalianLessonLanguageError extends TextModelParseError {
  readonly fields: string[];

  constructor(fields: string[]) {
    super(`Lesson contains non-Italian learner-visible content: ${fields.join(", ")}.`);
    this.fields = fields;
  }
}

interface VisibleField {
  path: string;
  text: string;
}

/** Every string a learner can see in one lesson, including answer feedback. */
export function learnerVisibleLessonFields(lesson: ItemLesson): VisibleField[] {
  const fields: VisibleField[] = [{ path: "intro", text: lesson.intro }];
  if (lesson.definition) fields.push({ path: "definition", text: lesson.definition });
  lesson.examples.forEach((text, i) => fields.push({ path: `examples[${i}]`, text }));
  lesson.newWords.forEach((word, i) => {
    fields.push({ path: `newWords[${i}].lemma`, text: word.lemma });
    fields.push({ path: `newWords[${i}].definition`, text: word.definition });
    if (word.example) fields.push({ path: `newWords[${i}].example`, text: word.example });
  });
  lesson.exercises.forEach((exercise, i) => {
    fields.push({ path: `exercises[${i}].prompt`, text: exercise.prompt });
    if (exercise.definition) fields.push({ path: `exercises[${i}].definition`, text: exercise.definition });
    exercise.options.forEach((text, j) => fields.push({ path: `exercises[${i}].options[${j}]`, text }));
    fields.push({ path: `exercises[${i}].answer`, text: exercise.answer });
    fields.push({ path: `exercises[${i}].rationale`, text: exercise.rationale });
  });
  return fields;
}

export function assertItalianLesson(lesson: ItemLesson): void {
  const fields = learnerVisibleLessonFields(lesson);
  if (fields.length > MAX_FIELDS) {
    throw new ItalianLessonLanguageError(["too-many-fields"]);
  }
  const rejected = fields
    .filter(({ text }) => !validateItalianText(text).valid)
    .map(({ path }) => path);
  if (rejected.length > 0) throw new ItalianLessonLanguageError(rejected);
}
