"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { LIBRARY_SECTIONS } from "@/lib/nav";

// The Library (E-44 criterion 6, D-26). ONE entry holding everything that used to
// compete with the daily plan: focus, the phrasebook, the archive, slips, the letter,
// readings, listen-and-shadow, the pronunciation studio, the pattern lessons, the card
// browser, the tutor and the placement check.
//
// D-17's standing rule holds: demote, never delete. Every one of these surfaces is
// exactly as it was and every deep link still resolves — what changed is that none of
// them is a step in your day any more. This is the shelf you go to on purpose, not the
// pile you have to walk past.
//
// Each row states what is behind it in one factual line, because a list of eleven
// nouns is not navigable and "Slips" tells a new learner nothing.

export default function LibraryPage() {
  const reduced = usePrefersReducedMotion();
  return (
    <div data-library className="mx-auto max-w-2xl p-8">
      <h1 className="text-[34px] font-bold tracking-tight">Library</h1>
      <p className="mt-1 text-[17px] text-secondary">
        Everything Erika keeps, whenever you want it. Your day is on the Learn tab.
      </p>

      <motion.div
        variants={staggerContainer(reduced)}
        initial="initial"
        animate="animate"
        className="mt-8 flex flex-col gap-8"
      >
        {LIBRARY_SECTIONS.map((section) => (
          <motion.section key={section.title} variants={staggerItem(reduced)} className="flex flex-col gap-3">
            <span className="text-[13px] font-medium uppercase tracking-[0.06em] text-secondary">
              {section.title}
            </span>
            <ul className="flex flex-col gap-2">
              {section.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    data-library-link={item.href}
                    className="flex items-center justify-between gap-4 rounded-card bg-card p-5 shadow-card transition-transform active:scale-[0.99]"
                  >
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="text-[17px] font-medium text-ink">{item.label}</span>
                      <span className="text-[15px] text-secondary">{item.note}</span>
                    </span>
                    <ArrowRight size={20} strokeWidth={1.5} className="shrink-0 text-secondary" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </motion.section>
        ))}
      </motion.div>
    </div>
  );
}
