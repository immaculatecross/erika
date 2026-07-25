"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Library as LibraryIcon, Settings as SettingsIcon } from "lucide-react";
import { LIBRARY } from "@/lib/nav";
import { TabBar } from "./tab-bar";

// The two-tab shell frame (E-30, DESIGN.md; reshaped at E-44). A sticky glass header
// carries the wordmark and two chrome leaves — the Library and Settings — and the
// bottom TabBar (Record · Learn) is the primary navigation.
//
// The section sub-nav is GONE (D-26). It was a second navigation layer whose whole
// purpose was keeping eight destinations one tap from the daily plan, which is the
// pile of errands this version exists to remove. Everything it held is behind the
// Library icon, and nothing is unreachable.
//
// Chrome, not content: it recedes so the language stays the story.

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const onSettings = pathname === "/settings" || pathname.startsWith("/settings/");
  const onLibrary = pathname === LIBRARY.href || pathname.startsWith(`${LIBRARY.href}/`);

  return (
    <div className="flex min-h-screen flex-col">
      <header
        data-app-header
        className="sticky top-0 z-30 border-b border-hairline bg-page/80 backdrop-blur-[20px]"
      >
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="text-[22px] font-semibold tracking-tight text-ink">
            Erika
          </Link>
          <div className="flex items-center gap-1">
            <Link
              href={LIBRARY.href}
              aria-label={LIBRARY.label}
              data-library-entry
              data-active={onLibrary}
              className={`inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
                onLibrary ? "bg-accent text-accent-ink" : "text-secondary hover:bg-hairline hover:text-ink"
              }`}
            >
              <LibraryIcon size={20} strokeWidth={1.5} aria-hidden />
            </Link>
            <Link
              href="/settings"
              aria-label="Settings"
              data-settings-gear
              data-active={onSettings}
              className={`inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
                onSettings ? "bg-accent text-accent-ink" : "text-secondary hover:bg-hairline hover:text-ink"
              }`}
            >
              <SettingsIcon size={20} strokeWidth={1.5} aria-hidden />
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 pb-24">{children}</main>

      <TabBar />
    </div>
  );
}
