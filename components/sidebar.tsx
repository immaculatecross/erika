"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AudioLines, GraduationCap, Target, Library, History, Settings as SettingsIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { href: "/", label: "Sessions", icon: AudioLines },
  { href: "/practice", label: "Practice", icon: GraduationCap },
  { href: "/focus", label: "Focus", icon: Target },
  { href: "/phrasebook", label: "Phrasebook", icon: Library },
  { href: "/archive", label: "Archive", icon: History },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function Sidebar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="flex w-56 shrink-0 flex-col gap-1 border-r border-hairline bg-page p-4"
    >
      <span className="px-3 pb-4 pt-2 text-[22px] font-semibold tracking-tight">Erika</span>
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            data-active={active ? "true" : "false"}
            className={`flex items-center gap-3 rounded-control px-3 py-2 text-[15px] transition-colors ${
              active
                ? "bg-accent text-accent-ink"
                : "text-secondary hover:bg-hairline hover:text-ink"
            }`}
          >
            <Icon size={20} strokeWidth={1.5} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
