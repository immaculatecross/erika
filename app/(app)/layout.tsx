import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getDb } from "@/lib/db";
import { onboardingComplete } from "@/lib/onboarding/state";
import { PATHNAME_HEADER, onboardingRedirect } from "@/lib/onboarding/routing";

// The first-run gate, and the two-tab chrome, for everything that is not onboarding
// (E-46 criterion 1, D-26).
//
// Every page of the product lives inside this route group; `/welcome` and `/api`
// live outside it. So entering the app is always a segment change at this level and
// this layout is always rendered — for a typed URL, for a deep link, for a bookmark,
// and for the client-side `<Link>` navigation that slipped past the same check in
// the root layout (see app/layout.tsx for the measurement).
//
// The rule it applies is pure and lives in lib/onboarding/routing.ts, where it can
// be mutated and tested; the facts it supplies are the requested path and whether
// this database has ever met anybody (lib/onboarding/state.ts).
//
// A database that cannot be opened at all is treated as "not onboarded" rather than
// crashing every route — the v0.4 cold-start blocker (#47) was exactly a fresh-DB
// failure visible only inside Next's server bundle, and this is now the one code
// path every page render passes through.

function isOnboarded(): boolean {
  try {
    return onboardingComplete(getDb());
  } catch {
    return false;
  }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = (await headers()).get(PATHNAME_HEADER) ?? "/";
  const destination = onboardingRedirect(pathname, isOnboarded());
  if (destination) redirect(destination);
  return <AppShell>{children}</AppShell>;
}
