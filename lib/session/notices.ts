// Every notice the session can show when something cannot run (E-44 criterion 3),
// in ONE place. Pure and client-safe.
//
// The invariant this file exists to hold: **every step either completes or offers a
// real way forward.** Three rules follow from it, and each is asserted by a test
// rather than promised by a comment (RETRO-004: "a claim enforced only by prose will
// drift" — the last repair that headlined its own copy and wrote "cannot drift apart
// again" had zero tests, and restoring the exact false sentence passed 994/994):
//
//   1. A STANDING condition is never described as "right now" or "just now". A
//      missing API key and a spent monthly budget are both still true tomorrow
//      morning; calling either "right now" is the lie RETRO-004 named thirteen times.
//      Only `model-transient` — a call that failed once and may well succeed on the
//      next tap — may use that wording, and it is the only notice that does.
//   2. Every notice that names a remedy carries a WORKING control. "Raise the cap in
//      Settings" shipped as prose beside no link at all; here `action.href` is a real
//      in-app route and a test resolves every one of them against the app's routes.
//   3. A retry that retries. `retryable` is what the runner binds its retry control
//      to — a control that re-runs the exact call that failed, not a page reload.

/** Everything that can stop a step from running. */
export type NoticeReason =
  | "no-key"
  | "key-rejected"
  | "budget"
  | "model-transient"
  | "mic-denied"
  | "save-failed"
  | "in-flight"
  | "nothing-to-teach"
  | "no-cards"
  | "not-recorded";

export interface Notice {
  reason: NoticeReason;
  /** One quiet sentence — what is true. Never an apology, never a cheer. */
  body: string;
  /** The way forward, or null when the step simply has nothing to do. */
  action: { label: string; href: string } | null;
  /** A retry control is meaningful here (the condition may clear on the next call). */
  retryable: boolean;
  /** True while the condition will still hold on the next page load without an
   *  operator action or the calendar turning over. Governs rule 1. */
  standing: boolean;
}

const SETTINGS = "/settings";

const NOTICES: Record<NoticeReason, Notice> = {
  // PERMANENT until someone sets a key. E-42 put the requirement in Settings; this
  // is the same fact stated at the moment it bites, with the link that fixes it.
  "no-key": {
    reason: "no-key",
    body: "Erika writes exercises and speaks with you through the OpenAI API, and no API key is set on this machine. Settings says where to put one.",
    action: { label: "Open Settings", href: SETTINGS },
    retryable: false,
    standing: true,
  },
  // A key IS set and OpenAI refused it (401/403). Standing, and a different remedy
  // from "no key at all" — which is the whole reason it is not folded into a generic
  // "unavailable": telling someone who has configured a key that none is set sends
  // them to check something that is already correct.
  "key-rejected": {
    reason: "key-rejected",
    body: "The API key on this machine was refused by OpenAI. It may have been rotated or revoked. Settings says where the key lives.",
    action: { label: "Open Settings", href: SETTINGS },
    retryable: true,
    standing: true,
  },
  // STANDING until the month rolls or the cap is raised — so it names both, and the
  // link works. Never "right now": the budget will still be spent tomorrow.
  budget: {
    reason: "budget",
    body: "The monthly budget is spent. It frees up when the month rolls over, or raise the cap in Settings.",
    action: { label: "Open Settings", href: SETTINGS },
    retryable: false,
    standing: true,
  },
  // The one genuinely transient condition, and therefore the only one allowed to say
  // "just now". It is retryable, and the retry re-runs the call.
  "model-transient": {
    reason: "model-transient",
    body: "Erika could not reach the lesson model just now.",
    action: null,
    retryable: true,
    standing: false,
  },
  // The browser is refusing the microphone. STANDING — it survives every reload until
  // the learner changes a browser setting Erika cannot reach, so it must not be
  // softened, and it must not be silent: without this the conversation step would sit
  // there offering "Start talking" into a page that cannot work, and the DAY would
  // never complete. The remedy is genuinely outside the app, so this is the one notice
  // whose way forward is an instruction rather than a link — naming the exact place.
  "mic-denied": {
    reason: "mic-denied",
    body: "Your browser is blocking the microphone, so Erika cannot hear you. Allow microphone access for this site in your browser's address-bar permissions, then reload.",
    action: null,
    retryable: true,
    standing: true,
  },
  // A grade that did not reach the server. Transient, and the retry re-sends THE SAME
  // grade rather than reloading — the old review screen swallowed this and advanced
  // anyway, which lost the review silently and left the learner sure they had done it.
  "save-failed": {
    reason: "save-failed",
    body: "That answer could not be saved just now — nothing was lost, and it can be sent again.",
    action: null,
    retryable: true,
    standing: false,
  },
  // Another tab won the lesson's claim and has not finished writing it. Genuinely
  // momentary, and genuinely fixed by tapping again — which is why it exists at all:
  // the same condition used to return a 202 the client read as success, then crashed
  // on the missing body with no copy of any kind.
  "in-flight": {
    reason: "in-flight",
    body: "Erika is still writing this lesson.",
    action: null,
    retryable: true,
    standing: false,
  },
  "nothing-to-teach": {
    reason: "nothing-to-teach",
    body: "There is nothing new at your level to teach today. Your reviews will keep coming back on schedule, and new material returns as your level moves.",
    action: null,
    retryable: false,
    standing: true,
  },
  "no-cards": {
    reason: "no-cards",
    body: "No cards are due today. Cards come from your own recordings and return on their own schedule.",
    action: null,
    retryable: false,
    standing: true,
  },
  // The tutor cannot be credited on this build, so no conversation step is offered.
  // Stated as the fact it is, with no promise about when it changes.
  "not-recorded": {
    reason: "not-recorded",
    body: "Spoken conversations are not recorded on this build, so one cannot count toward your day.",
    action: null,
    retryable: false,
    standing: true,
  },
};

export function noticeFor(reason: NoticeReason): Notice {
  return NOTICES[reason];
}

/** Every notice, for the tests that enforce the three rules above. */
export function allNotices(): Notice[] {
  return Object.values(NOTICES);
}

/** The forbidden softeners. A standing condition described with either of these is
 *  the RETRO-004 defect, and `tests/session-notices.test.ts` fails on it. */
export const TRANSIENT_WORDS = ["right now", "just now"] as const;
