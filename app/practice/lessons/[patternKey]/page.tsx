"use client";

import { useParams } from "next/navigation";
import { LessonRunner } from "@/components/lesson-runner";

// The lesson runner route (E-6b): a thin client wrapper that reads the pattern key
// from the path and hands it to the runner, which loads, steps, grades and
// completes the lesson. The key is URL-encoded in the link (`category:<category>`
// → `category%3A…`); `useParams` returns it still-encoded, so decode it here —
// category names never contain a literal `%`, so a decode is always safe.
export default function LessonRunnerPage() {
  const { patternKey } = useParams<{ patternKey: string }>();
  return <LessonRunner patternKey={decodeURIComponent(patternKey)} />;
}
