"use client";

import { motion, useSpring, useTransform, type MotionValue } from "framer-motion";

// The recording waveform "breathing with your voice" — DESIGN.md's one signature
// moment for this surface. Bars are driven by the real input level (a MotionValue
// fed from the AnalyserNode). Normally each bar springs on scaleY (transform only,
// 60fps, transform-origin centre so it swells symmetrically). Under
// prefers-reduced-motion it degrades to a plain level readout: height, no spring,
// no transform. Monochrome ink bars — the recording state's red lives elsewhere.

// Centre bars swing more than the edges, so the row reads as a waveform.
const WEIGHTS = [0.45, 0.7, 0.9, 1, 0.9, 0.7, 0.45];

// Speech RMS is small; lift it into a visible range and floor it so idle bars
// still read as a quiet baseline rather than vanishing.
function barFraction(level: number, weight: number): number {
  const amplified = Math.min(1, level * 3.2);
  return 0.12 + amplified * weight * 0.88;
}

function MeterBar({
  level,
  weight,
  reduced,
}: {
  level: MotionValue<number>;
  weight: number;
  reduced: boolean;
}) {
  const fraction = useTransform(level, (v) => barFraction(v, weight));
  const scaleY = useSpring(fraction, { stiffness: 260, damping: 28 });
  const height = useTransform(fraction, (f) => `${Math.round(f * 100)}%`);

  if (reduced) {
    return (
      <motion.span
        data-spring="false"
        style={{ height }}
        className="w-1 rounded-full bg-accent"
      />
    );
  }
  return (
    <motion.span
      data-spring="true"
      style={{ scaleY }}
      className="h-full w-1 origin-center rounded-full bg-accent"
    />
  );
}

export function LevelMeter({
  level,
  reduced,
}: {
  level: MotionValue<number>;
  reduced: boolean;
}) {
  return (
    <div
      data-level-meter
      data-reduced-motion={reduced ? "true" : "false"}
      className="flex h-8 items-center gap-1"
      aria-hidden
    >
      {WEIGHTS.map((weight, i) => (
        <MeterBar key={i} level={level} weight={weight} reduced={reduced} />
      ))}
    </div>
  );
}
