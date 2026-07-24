import type { TodayThread } from "@/lib/today-thread";

// "Today's thread" (E-38, RETRO-003 / D-19). One quiet sentence tying today's plan
// to something the learner actually said today. The claim is assembled from facts
// the builder already verified (lib/today-thread.ts): the item was on today's plan,
// and a spontaneous production positive attributed to the learner's own speech was
// minted for it today, at that time of day.
//
// The wording is chosen to say EXACTLY what is known and no more. "Today's plan
// included X" is a fact about the composer; "you used it in this morning's
// recording" is a fact about the evidence log. Neither asserts that the learner
// opened the lesson, and nothing here congratulates them — it is an observation, in
// the editor's voice (DESIGN "Copy"). When there is no thread the caller renders
// nothing at all; there is no fallback sentence.

export function threadSentence(thread: TodayThread): string {
  return `Today's plan included ${thread.label} — and you used it in ${thread.partOfDay}'s recording.`;
}

export function TodayThreadLine({ thread }: { thread: TodayThread }) {
  return (
    <p data-today-thread data-thread-item={thread.itemId} className="text-[15px] text-secondary">
      Today&rsquo;s plan included <em className="not-italic font-medium text-ink">{thread.label}</em> — and you
      used it in {thread.partOfDay}&rsquo;s recording.
    </p>
  );
}
