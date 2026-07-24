"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { AudioLines, GraduationCap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { activeTab, TABS, type TabId } from "@/lib/nav";
import { SPRING } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";

// The phone-first bottom tab bar (E-30, DESIGN.md). Two tabs — Record · Learn —
// on glass over a translucent surface (backdrop-blur 20px, hairline top border),
// the active tab in the ink accent (black light / white dark, D-14), inactive in
// secondary. Lucide at 1.5px/20px. The active pill springs between tabs with a
// shared layout animation — transform and opacity only, 60fps; under
// prefers-reduced-motion the shared id drops so it cross-fades in place instead.
// No third hue, no decoration: the one signature moment here is the sliding pill.

const ICONS: Record<TabId, LucideIcon> = {
  record: AudioLines,
  learn: GraduationCap,
};

export function TabBar() {
  const pathname = usePathname();
  const active = activeTab(pathname);
  const reduced = usePrefersReducedMotion();

  return (
    <nav
      aria-label="Primary"
      data-tab-bar
      className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-page/80 backdrop-blur-[20px]"
    >
      <ul className="mx-auto flex max-w-2xl items-stretch px-2 pb-[env(safe-area-inset-bottom)]">
        {TABS.map((t) => {
          const isActive = active === t.id;
          const Icon = ICONS[t.id];
          return (
            <li key={t.id} className="flex-1">
              <Link
                href={t.href}
                data-tab={t.id}
                data-active={isActive}
                aria-current={isActive ? "page" : undefined}
                className={`relative flex flex-col items-center gap-1 px-3 pb-2 pt-2.5 text-[11px] font-medium uppercase tracking-[0.06em] transition-colors ${
                  isActive ? "text-accent" : "text-secondary hover:text-ink"
                }`}
              >
                {isActive && (
                  <motion.span
                    layoutId={reduced ? undefined : "tab-indicator"}
                    transition={SPRING}
                    aria-hidden
                    className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-accent"
                  />
                )}
                <Icon size={20} strokeWidth={1.5} aria-hidden />
                <span>{t.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
