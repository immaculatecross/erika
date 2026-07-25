"use client";

import Link from "next/link";

// Step four: the conversation (E-44 criterion 4). The thinnest possible coupling to
// the tutor — a link that starts one, and a question afterwards.
//
// This component knows exactly two things about the tutor: where it lives, and whether
// E-43's durable record says a conversation met its minimum today. It does not know
// the transport, the model, the persona, the minimum's value or how the minimum is
// measured — all of which are E-43's, and at least one of which changed while this was
// being written. `met` comes from the server, which read `tutor_conversations`.
//
// D-24, strictly: a conversation that fell short is not a failure and nothing here
// treats it as one. There is no countdown, no "you need N more minutes", no warning,
// no guilt. The step simply has not completed, and the way forward is the same door.

export function ConversationStep({ met, onDone }: { met: boolean; onDone: () => void }) {
  if (met) {
    return (
      <div data-step-conversation data-conversation-met="true" className="flex flex-col gap-5">
        <h1 className="text-[34px] font-bold tracking-tight">You spoke today</h1>
        <p className="text-[17px] leading-[1.47] text-secondary">
          Your conversation is recorded, and it counts toward today.
        </p>
        <button
          type="button"
          data-step-continue
          onClick={onDone}
          className="self-start rounded-full bg-accent px-6 py-3 text-[17px] font-medium text-accent-ink transition-transform active:scale-[0.98]"
        >
          Finish
        </button>
      </div>
    );
  }

  return (
    <div data-step-conversation data-conversation-met="false" className="flex flex-col gap-5">
      <h1 className="text-[34px] font-bold tracking-tight">Talk with Erika</h1>
      <p className="text-[17px] leading-[1.47] text-secondary">
        A spoken conversation in Italian, steered toward what you have been getting wrong. It counts
        toward today once it has run long enough.
      </p>
      <Link
        href="/practice/tutor"
        data-open-tutor
        className="self-start rounded-full bg-accent px-6 py-3 text-[17px] font-medium text-accent-ink transition-transform active:scale-[0.98]"
      >
        Start talking
      </Link>
      <p className="text-[15px] text-secondary">
        Come back here when you are done — this step will be waiting.
      </p>
    </div>
  );
}
