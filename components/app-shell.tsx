"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings as SettingsIcon } from "lucide-react";
import { activeTab, isSectionActive, sectionFor, type NavDest } from "@/lib/nav";
import { TabBar } from "./tab-bar";

// The two-tab shell frame (E-30, DESIGN.md), phone-first. A sticky glass header
// carries the wordmark, the active tab's section sub-nav (the Library under
// Record; today/focus/letter under Learn), and the Settings gear — Settings left
// the nav and lives behind this gear, not a tab. The bottom TabBar (Record ·
// Learn) is the primary navigation. Content scrolls under both chrome layers
// (backdrop-blur glass) and clears the fixed bar with bottom padding. On wider
// viewports the same centered column reads as a graceful degrade — phone is the
// design target. Chrome, not content: it recedes so the language stays the story.

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const tab = activeTab(pathname);
  const section = sectionFor(tab);
  const onSettings = pathname === "/settings" || pathname.startsWith("/settings/");

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
        {section.length > 0 && <SectionNav pathname={pathname} section={section} />}
      </header>

      <main className="flex-1 pb-24">{children}</main>

      <TabBar />
    </div>
  );
}

function SectionNav({ pathname, section }: { pathname: string; section: NavDest[] }) {
  return (
    <nav
      aria-label="Section"
      data-section-nav
      className="mx-auto flex w-full max-w-3xl gap-2 overflow-x-auto px-4 pb-3"
    >
      {section.map((d) => {
        const active = isSectionActive(pathname, d.href);
        return (
          <Link
            key={d.href}
            href={d.href}
            data-section-link={d.href}
            data-active={active}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
              active ? "bg-accent text-accent-ink" : "bg-card text-secondary hover:text-ink"
            }`}
          >
            {d.label}
          </Link>
        );
      })}
    </nav>
  );
}
