import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getDb } from "@/lib/db";
import { onboardingComplete } from "@/lib/onboarding/state";
import { PATHNAME_HEADER, onboardingRedirect, showsAppChrome } from "@/lib/onboarding/routing";
import "./globals.css";

export const metadata: Metadata = {
  title: "Erika",
  description: "Master the language you already speak.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

// The first-run gate (E-46 criterion 1, D-26). It lives in the ROOT layout on
// purpose: every page in the app renders inside it, so a deep link, a bookmark, a
// typed URL and a client-side <Link> all pass through here, and there is no page
// whose own code runs first. The rule itself is pure and lives in
// lib/onboarding/routing.ts, where it can be tested and mutated; this file only
// supplies the two facts it needs — where the request was going, and whether the
// database has ever met anybody.
//
// The chrome is suppressed in the same breath. A forced flow with a tab bar under
// it is not forced; it is a suggestion with a visible way out.
//
// A database that cannot be opened at all is treated as "not onboarded" rather
// than crashing every route — the v0.4 cold-start blocker (#47) was exactly a
// fresh-database failure that only appeared inside Next's server bundle, and this
// is now the one code path every page render passes through.

function isOnboarded(): boolean {
  try {
    return onboardingComplete(getDb());
  } catch {
    return false;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = (await headers()).get(PATHNAME_HEADER) ?? "/";
  const complete = isOnboarded();
  const destination = onboardingRedirect(pathname, complete);
  if (destination) redirect(destination);

  return (
    <html lang="en">
      <body>
        {showsAppChrome(pathname, complete) ? <AppShell>{children}</AppShell> : children}
      </body>
    </html>
  );
}
