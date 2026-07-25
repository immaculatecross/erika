import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readSettings } from "@/lib/settings";
import { monthToDateSpend } from "@/lib/analysis/budget";
import { tutorRealtimeModel } from "@/lib/analysis/rates";
import { buildTutorSessionConfig } from "@/lib/tutor/session-config";
import { openTutorLease, releaseTutorLease, defaultTutorMinutes, estimateTutorSessionUsd } from "@/lib/tutor/money";
import { openAiClientSecretMinter, MinterUnavailableError } from "@/lib/tutor/mint";
import { closeAbandonedConversations, openConversation, tutorMinimumSeconds } from "@/lib/tutor/conversations";

// The tutor session's mint + lease route (E-34, rebuilt at E-43). The secret-exposure
// + spend boundary, both never-waivable.
//
//   GET  — what the surface needs before a call: the minimum that makes a
//          conversation count, whether a key is even configured, and the budget
//          headroom. No side effects (D-25: a GET records nothing).
//   POST — OPEN a session: open the durable conversation record (v29), reserve the
//          estimate against the cap (a truthful refusal at the cap opens NOTHING and
//          mints NO token), then mint a short-lived EPHEMERAL client secret
//          server-side. The response carries ONLY the ephemeral secret + the session
//          config the browser needs — the real OPENAI_API_KEY is used only inside the
//          minter and never reaches the client.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const db = getDb();
  const settings = readSettings(db);
  const model = tutorRealtimeModel();
  const minutes = defaultTutorMinutes();
  const estimateUsd = estimateTutorSessionUsd(model, minutes);
  const spentThisMonth = monthToDateSpend(db);
  return NextResponse.json({
    model,
    minutes,
    estimateUsd,
    spentThisMonth,
    budgetUsd: settings.monthlyBudgetUsd,
    remainingUsd: Math.max(settings.monthlyBudgetUsd - spentThisMonth, 0),
    // What the tutor surface needs to show calm progress (criterion 6) without a
    // second round-trip, and to say something TRUE before the learner presses
    // anything rather than leaking an internal error string after they do.
    minSeconds: tutorMinimumSeconds(db),
    voice: settings.tutorVoice,
    keyConfigured: Boolean(process.env.OPENAI_API_KEY),
  });
}

export async function POST() {
  const db = getDb();
  const settings = readSettings(db);
  const minutes = defaultTutorMinutes();
  const { config, targets } = buildTutorSessionConfig(db);
  const estimateUsd = estimateTutorSessionUsd(config.model, minutes);

  // Any conversation left open past the point where it could still be running is
  // recorded as ended-with-unknown-duration here, so the record self-heals without a
  // second process (lib/tutor/conversations.ts).
  closeAbandonedConversations(db);

  // Reserve-before-call: no session opens over the cap, and no token is minted.
  const tutorId = randomUUID();
  const minSeconds = tutorMinimumSeconds(db);
  const lease = openTutorLease(db, tutorId, config.model, minutes, settings.monthlyBudgetUsd);
  if (!lease) {
    return NextResponse.json(
      {
        error: {
          code: "budget",
          message: `A conversation is estimated at ${estimateUsd.toFixed(2)} USD, which would exceed the monthly budget. No conversation was started.`,
        },
        estimateUsd,
      },
      { status: 402 },
    );
  }

  let secret;
  try {
    secret = await openAiClientSecretMinter.mint(config);
  } catch (err) {
    // No completion, no charge — release the lease so the cap is freed.
    releaseTutorLease(db, tutorId);
    if (err instanceof MinterUnavailableError) {
      return NextResponse.json(
        {
          error: {
            code: "tutor_unavailable",
            message: process.env.OPENAI_API_KEY
              ? "Erika could not reach the conversation service just now. Try again in a moment."
              : "Erika needs an OpenAI API key to hold a conversation. Add one in Settings and come back.",
          },
        },
        { status: 503 },
      );
    }
    throw err;
  }

  // The conversation record opens only once a session really exists, so a refused or
  // failed start leaves no phantom conversation in the day's history.
  openConversation(db, tutorId, minSeconds);

  return NextResponse.json({
    tutorId,
    // The ONLY credential the browser receives — the short-lived ephemeral secret.
    clientSecret: secret.value,
    expiresAt: secret.expiresAt,
    model: config.model,
    estimateUsd,
    minutes,
    minSeconds,
    // The session config the browser applies over WebRTC (instructions + tools +
    // text-only output). It carries NO key.
    session: config,
    targets,
  });
}
