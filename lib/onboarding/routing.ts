// Where a request is allowed to go on a database that has never met anybody
// (E-46 criterion 1, D-26). PURE and client-safe — no DB, no React, no Next —
// so the one rule that decides "onboarding, or the app?" is unit-testable and
// mutation-provable on its own.
//
// THE INVARIANT, stated once so it can be checked:
//
//   (a) FORCE — while onboarding is incomplete, every navigable page resolves to
//       `/welcome`. Not the Learn home, not a deep link to `/practice/tutor`, not
//       a Library page, not `/settings`.
//   (b) NEVER TRAP — while onboarding is complete, NO path is ever redirected to
//       `/welcome`. `onboardingRedirect` returns null for every pathname the
//       moment `complete` is true, with no exceptions and no second condition.
//
// (b) is the half that matters more, and it is why `complete` is checked FIRST
// and alone. The opposite of the defect this milestone fixes is a learner with a
// year of recordings bounced into a vocabulary check on every click, unable to
// reach their own data — a strictly worse failure than the one being fixed. The
// enumeration of what can make `complete` true lives in ./state.ts; this file
// only guarantees that once it is true, nothing here can override it.
//
// Enumerated paths that could violate (a), and how each is closed:
//   · a deep link / typed URL / bookmark → the gate runs in the layout of the
//     route group every page lives in, so it renders before any page's own code.
//   · a client-side <Link> navigation → measured, not assumed. In the ROOT layout
//     this leaked: the App Router caches the root layout, so an RSC navigation
//     returned 200 and the page without re-rendering it. The gate therefore lives
//     one level down, in `app/(app)/layout.tsx`, which is outside the client's
//     cached tree whenever the learner is on `/welcome` and must be rendered.
//   · the tab bar and section nav → they live inside the gated route group's own
//     layout, so they are not even rendered until the gate has been passed.
//   · `/welcome` itself → exempt, or the redirect would loop.
//   · `/api/*`, `/_next/*`, files → never reach a layout; exempted here anyway so
//     the predicate is total and a future caller cannot misuse it.

/** The one onboarding surface. Every incomplete-onboarding page lands here. */
export const ONBOARDING_PATH = "/welcome";

/**
 * Where onboarding deposits the learner: their first session, composed from what the
 * assessment just learned about them (E-46 criterion 5, Amendment 1 criterion 9).
 *
 * ONE constant, so the seam is a rename rather than a search. On `master` today the
 * day's composed material is `/practice/learn` — the composer's own selection for
 * this local day, at the learner's placed edge. WO-E44 introduces `/practice/session`
 * as the single daily session; when it merges, this constant moves and nothing else
 * does.
 */
export const FIRST_SESSION_PATH = "/practice/learn";

/** The pathname the root layout reads to know where the request was going. The
 *  middleware stamps it; a layout cannot otherwise see its own URL. */
export const PATHNAME_HEADER = "x-erika-pathname";

/** Is this the onboarding surface itself (or something under it)? */
export function isOnboardingPath(pathname: string): boolean {
  return pathname === ONBOARDING_PATH || pathname.startsWith(`${ONBOARDING_PATH}/`);
}

/** Paths that are not pages: they never render a layout, so they are never gated. */
function isNonPage(pathname: string): boolean {
  return (
    pathname.startsWith("/api/") ||
    pathname === "/api" ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  );
}

/**
 * Where this request must go instead, or null to let it through.
 *
 * @param pathname the requested path (no query string)
 * @param complete whether onboarding is done — see `onboardingComplete` in ./state
 */
export function onboardingRedirect(pathname: string, complete: boolean): string | null {
  // (b) NEVER TRAP. First, alone, unconditional.
  if (complete) return null;
  if (isOnboardingPath(pathname)) return null;
  if (isNonPage(pathname)) return null;
  return ONBOARDING_PATH;
}
