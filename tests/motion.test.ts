import { describe, expect, it } from "vitest";
import { pageVariants, staggerContainer, staggerItem } from "@/lib/motion";

// The reduced-motion contract: no variant may carry a transform (x/y/scale)
// when reduced — opacity only. A regression here breaks DESIGN.md's promise.
function hasTransform(state: Record<string, unknown> | undefined): boolean {
  if (!state) return false;
  return ["x", "y", "scale", "rotate"].some((k) => k in state);
}

describe("motion variants", () => {
  it("uses a 12px rise for page transitions normally", () => {
    const v = pageVariants(false);
    expect((v.initial as { y: number }).y).toBe(12);
  });

  it("degrades page transitions to opacity-only when reduced", () => {
    const v = pageVariants(true);
    expect(hasTransform(v.initial as Record<string, unknown>)).toBe(false);
    expect(hasTransform(v.animate as Record<string, unknown>)).toBe(false);
    expect(hasTransform(v.exit as Record<string, unknown>)).toBe(false);
    expect((v.initial as { opacity: number }).opacity).toBe(0);
  });

  it("degrades list items to opacity-only when reduced", () => {
    expect(hasTransform(staggerItem(false).initial as Record<string, unknown>)).toBe(true);
    expect(hasTransform(staggerItem(true).initial as Record<string, unknown>)).toBe(false);
  });

  it("drops the stagger cadence to zero when reduced", () => {
    const reduced = staggerContainer(true).animate as { transition: { staggerChildren: number } };
    const normal = staggerContainer(false).animate as { transition: { staggerChildren: number } };
    expect(reduced.transition.staggerChildren).toBe(0);
    expect(normal.transition.staggerChildren).toBeGreaterThan(0);
  });
});
