"use client";

import { motion } from "framer-motion";
import { Check, Circle } from "lucide-react";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import type { Requirement } from "@/lib/onboarding/requirements";

// What Erika needs, said once and in plain prose (E-46 criterion 2). Four rows,
// no illustrations, no accordion: this is the screen that has to be readable at a
// glance on a phone by somebody who has never seen the product.
//
// The key row is the only one that carries a MARK, because it is the only one the
// server actually checked. The other three are facts about how Erika works, not
// tasks to tick off, and giving them a hollow circle would invite the learner to
// hunt for a way to satisfy something that is simply true. Where a fact has a
// literal — a variable, a command — it is rendered in DESIGN's inline-code
// treatment so it can be copied without ambiguity.

const CAPTION = "text-[13px] font-medium uppercase tracking-[0.06em] text-secondary";

/**
 * A mark appears ONLY on a requirement the server actually checked.
 *
 * The other three are facts about how Erika works, not tasks: giving them a hollow
 * circle would render four identical checkboxes and invite the learner to hunt for a
 * way to tick three things that are simply true. So they get nothing, and the one row
 * that carries a state carries it alone — which is also what makes it readable at a
 * glance, since it is the only one that needs the learner to act.
 */
function Mark({ satisfied }: { satisfied: boolean | null }) {
  if (satisfied === null) return null;
  return satisfied ? (
    <Check size={20} strokeWidth={1.5} className="mt-0.5 shrink-0 text-good" aria-hidden />
  ) : (
    <Circle size={20} strokeWidth={1.5} className="mt-0.5 shrink-0 text-secondary" aria-hidden />
  );
}

export function RequirementsStep({
  requirements,
  onContinue,
}: {
  requirements: Requirement[];
  onContinue: () => void;
}) {
  const reduced = usePrefersReducedMotion();
  return (
    <motion.div
      data-onboarding-step="needs"
      variants={staggerContainer(reduced)}
      initial="initial"
      animate="animate"
      className="flex flex-col gap-7"
    >
      <motion.header variants={staggerItem(reduced)} className="flex flex-col gap-2">
        <span className={CAPTION}>Before you start</span>
        <h1 className="text-[34px] font-bold leading-[1.1] tracking-[-0.022em]">
          Erika listens to you speak Italian, and teaches from what it hears.
        </h1>
        <p className="text-[17px] leading-[1.47] text-secondary">
          Four things are worth knowing now, so none of them surprises you later.
        </p>
      </motion.header>

      <motion.ul variants={staggerItem(reduced)} className="flex flex-col gap-3">
        {requirements.map((r) => (
          <motion.li
            key={r.id}
            variants={staggerItem(reduced)}
            data-requirement={r.id}
            data-satisfied={r.satisfied === null ? "unknown" : String(r.satisfied)}
            className="flex gap-3 rounded-card bg-card p-5 shadow-card"
          >
            <Mark satisfied={r.satisfied} />
            <div className="flex min-w-0 flex-col gap-1.5">
              <p className="text-[17px] font-medium text-ink">{r.title}</p>
              <p className="text-[15px] leading-[1.47] text-secondary">{r.detail}</p>
              {r.literal && (
                <code className="mt-0.5 w-fit max-w-full overflow-x-auto rounded bg-black/[0.06] px-2 py-1 font-mono text-[13px] text-ink dark:bg-white/[0.08]">
                  {r.literal}
                </code>
              )}
            </div>
          </motion.li>
        ))}
      </motion.ul>

      <motion.div variants={staggerItem(reduced)}>
        <button
          type="button"
          data-onboarding-continue
          onClick={onContinue}
          className="inline-flex rounded-full bg-accent px-5 py-2.5 text-[15px] font-medium text-accent-ink transition-transform hover:opacity-90 active:scale-[0.98]"
        >
          Find my level
        </button>
      </motion.div>
    </motion.div>
  );
}
