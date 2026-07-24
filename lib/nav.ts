// The two-tab information architecture (E-30, D-17). Pure and client-safe — no
// React, no icons, no DOM — so the route→tab mapping and the section groupings
// are unit-testable and shared by the shell chrome (components/app-shell.tsx,
// components/tab-bar.tsx). Icons live with the components that render them.
//
// Erika is a two-tab product: Record — the capture spine and everything about
// your recorded material (the Library: sessions, archive, phrasebook, slips) —
// and Learn — the daily course (today's plan, focus, the letter). Settings is
// not a tab; it sits behind a gear. Every path below already exists; this module
// only decides which tab owns it, so no deep link ever loses its home.

export type TabId = "record" | "learn";

/** A destination inside a tab's section sub-navigation. */
export interface NavDest {
  href: string;
  label: string;
}

/** The two primary tabs, in bar order. Record is the home tab. */
export const TABS: { id: TabId; href: string; label: string }[] = [
  { id: "record", href: "/", label: "Record" },
  { id: "learn", href: "/practice", label: "Learn" },
];

/** The Library sub-destinations under Record, in display order. */
export const RECORD_SECTION: NavDest[] = [
  { href: "/", label: "Sessions" },
  { href: "/archive", label: "Archive" },
  { href: "/phrasebook", label: "Phrasebook" },
  { href: "/slips", label: "Slips" },
];

/** The sub-destinations under Learn, in display order. */
export const LEARN_SECTION: NavDest[] = [
  { href: "/practice", label: "Today" },
  { href: "/focus", label: "Focus" },
  { href: "/letter", label: "Letter" },
];

// Learn owns the daily course; Record owns everything about recorded material.
// Learn is matched first so a future Record prefix can never shadow it.
const LEARN_PREFIXES = ["/practice", "/focus", "/letter"];
const RECORD_PREFIXES = ["/sessions", "/archive", "/phrasebook", "/slips"];

function underPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Which tab owns a pathname. `/` is Record's home. Settings (`/settings`) is a
 * gear leaf, owned by neither tab (returns null) so no tab reads as active there.
 * An unknown path also returns null rather than guessing.
 */
export function activeTab(pathname: string): TabId | null {
  if (pathname === "/") return "record";
  if (LEARN_PREFIXES.some((p) => underPrefix(pathname, p))) return "learn";
  if (RECORD_PREFIXES.some((p) => underPrefix(pathname, p))) return "record";
  return null;
}

/** The section list to show for a tab (empty for the gear leaf / unknown). */
export function sectionFor(tab: TabId | null): NavDest[] {
  if (tab === "record") return RECORD_SECTION;
  if (tab === "learn") return LEARN_SECTION;
  return [];
}

/**
 * Is this section destination the active one? `/` matches only the exact root;
 * every other href matches itself and its descendants (so `/slips/[id]` keeps
 * "Slips" lit, `/practice/review` keeps "Today" lit).
 */
export function isSectionActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return underPrefix(pathname, href);
}
