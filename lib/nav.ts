// The information architecture (E-30, D-17; reshaped at E-44 per D-26). Pure and
// client-safe — no React, no icons, no DOM — so the route→tab mapping and the Library
// groupings are unit-testable and shared by the shell chrome.
//
// Erika is still a two-tab product: Record — the capture spine — and Learn — one
// session a day. What E-44 changes is everything BELOW the tabs.
//
// THE SECTION SUB-NAV IS GONE. It was a whole navigation layer (Sessions · Archive ·
// Phrasebook · Slips under Record; Today · Focus · Letter under Learn) whose only job
// was to keep eight destinations one tap from the daily plan — which is precisely the
// "pile of optional errands" D-26 exists to remove. Focus, the phrasebook, the
// archive, slips, readings, shadow, the studio, the pattern lessons and the card
// browser now live behind ONE quiet Library entry in the header, beside the Settings
// gear. Chrome, not plan items.
//
// NOTHING IS DELETED AND EVERY DEEP LINK STILL RESOLVES (D-17's standing rule). Every
// path below already existed; this module only decides where it is reached FROM.

export type TabId = "record" | "learn";

/** A destination inside the Library. */
export interface NavDest {
  href: string;
  label: string;
  /** One factual line — what is actually behind the link, never a tagline. */
  note: string;
}

/** The two primary tabs, in bar order. Record is the home tab. */
export const TABS: { id: TabId; href: string; label: string }[] = [
  { id: "record", href: "/", label: "Record" },
  { id: "learn", href: "/practice", label: "Learn" },
];

/** The one Library entry, in the header beside the gear. */
export const LIBRARY: { href: string; label: string } = { href: "/library", label: "Library" };

/** Everything the Library holds, grouped. Order is by how often a learner reaches for
 *  it, not by which milestone built it. */
export const LIBRARY_SECTIONS: { title: string; items: NavDest[] }[] = [
  {
    title: "Your speech",
    items: [
      { href: "/archive", label: "Archive", note: "Every analyzed session, searchable." },
      { href: "/phrasebook", label: "Phrasebook", note: "You say X, natives say Y." },
      { href: "/slips", label: "Slips", note: "Mistakes that keep coming back, and what became of them." },
      { href: "/focus", label: "Focus", note: "What is costing you the most, by category and by hour." },
      { href: "/letter", label: "The letter", note: "This week's digest from your editor." },
    ],
  },
  {
    title: "Practice",
    items: [
      { href: "/practice/cards", label: "All cards", note: "The whole deck, including what is not due." },
      { href: "/practice/learn/studio", label: "Pronunciation studio", note: "Hear a line, say it back." },
      { href: "/practice/learn/shadow", label: "Listen and shadow", note: "A correct line, rendered, to repeat." },
      { href: "/practice/reading", label: "Reading", note: "Public-domain Italian at your level." },
      { href: "/practice/tutor", label: "Talk with Erika", note: "A spoken conversation, any time." },
    ],
  },
  {
    title: "Setup",
    items: [
      { href: "/practice/placement", label: "Find your level", note: "The vocabulary check, re-runnable." },
    ],
  },
];

// Learn owns the daily session; Record owns everything about recorded material. Learn
// is matched first so a future Record prefix can never shadow it. These mappings are
// UNCHANGED by E-44 — a deep link into `/focus` still reads as Learn, so the tab bar
// stays truthful wherever a learner lands from a bookmark.
const LEARN_PREFIXES = ["/practice", "/focus", "/letter"];
const RECORD_PREFIXES = ["/sessions", "/archive", "/phrasebook", "/slips"];

function underPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Which tab owns a pathname. `/` is Record's home. Settings (`/settings`) and the
 * Library (`/library`) are chrome leaves owned by neither tab (they return null), so
 * no tab reads as active there. An unknown path also returns null rather than guessing.
 */
export function activeTab(pathname: string): TabId | null {
  if (pathname === "/") return "record";
  if (underPrefix(pathname, LIBRARY.href)) return null;
  if (LEARN_PREFIXES.some((p) => underPrefix(pathname, p))) return "learn";
  if (RECORD_PREFIXES.some((p) => underPrefix(pathname, p))) return "record";
  return null;
}

/** Every Library destination, flattened — for the tests that prove each one resolves. */
export function libraryDestinations(): NavDest[] {
  return LIBRARY_SECTIONS.flatMap((s) => s.items);
}
