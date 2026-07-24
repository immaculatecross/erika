"use client";

import { useParams } from "next/navigation";
import { ItemLessonRunner } from "@/components/item-lesson-runner";

// The E-32 item-lesson runner route: a thin client wrapper that reads the knowledge
// item id from the path and hands it to the runner, which generates-on-open, steps,
// grades, and writes evidence. The id is URL-encoded in the link (a lemma id carries
// `:` and `#`, e.g. `lemma:casa#NOUN` → `lemma%3Acasa%23NOUN`); `useParams` returns
// it still-encoded, so decode it here.
export default function ItemLessonRunnerPage() {
  const { itemId } = useParams<{ itemId: string }>();
  return <ItemLessonRunner itemId={decodeURIComponent(itemId)} />;
}
