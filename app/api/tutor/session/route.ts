import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readSettings } from "@/lib/settings";
import { monthToDateSpend, releaseReservation, reserveSpend } from "@/lib/analysis/budget";
import {
  REALTIME_FLAGSHIP,
  TERRA_MODEL,
  TTS_MODEL,
  TUTOR_STT_MODEL,
  sttCallCost,
  terraReservationCost,
  ttsCallCost,
} from "@/lib/analysis/rates";
import { buildSelectedTutorPrompt, buildTutorSessionConfig } from "@/lib/tutor/session-config";
import { openTutorLease, releaseTutorLease, defaultTutorMinutes, estimateTutorSessionUsd } from "@/lib/tutor/money";
import { openAiClientSecretMinter, MinterUnavailableError } from "@/lib/tutor/mint";
import { closeAbandonedConversations, openConversation, tutorMinimumSeconds } from "@/lib/tutor/conversations";
import {
  DEFAULT_TUTOR_ARCHITECTURE,
  DEFAULT_TUTOR_PRESET,
  MAX_TRANSCRIPT_TURN_SECONDS,
  MAX_TUTOR_REPLY_CHARS,
  isTutorArchitecture,
  isTutorPromptPreset,
} from "@/lib/tutor/experiment";
import { classifyFailure, noticeFor } from "@/lib/session/notices";

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
  const model = REALTIME_FLAGSHIP;
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

export async function POST(request: Request) {
  const db = getDb();
  const settings = readSettings(db);
  const minutes = defaultTutorMinutes();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const architecture = isTutorArchitecture(body.architecture)
    ? body.architecture
    : DEFAULT_TUTOR_ARCHITECTURE;
  const preset = isTutorPromptPreset(body.preset) ? body.preset : DEFAULT_TUTOR_PRESET;
  const { config, targets, promptHash } = buildTutorSessionConfig(db, undefined, preset);
  const estimateUsd = estimateTutorSessionUsd(config.model, minutes);

  // Any conversation left open past the point where it could still be running is
  // recorded as ended-with-unknown-duration here, so the record self-heals without a
  // second process (lib/tutor/conversations.ts).
  closeAbandonedConversations(db);

  const tutorId = randomUUID();
  const minSeconds = tutorMinimumSeconds(db);
  if (architecture === "transcript") {
    if (!process.env.OPENAI_API_KEY) {
      const notice = "no-key";
      return NextResponse.json(
        { error: { code: "tutor_unavailable", message: noticeFor(notice).body }, notice },
        { status: 503 },
      );
    }
    const selected = buildSelectedTutorPrompt(db, architecture, preset);
    const preflightCost =
      sttCallCost(TUTOR_STT_MODEL, MAX_TRANSCRIPT_TURN_SECONDS) +
      terraReservationCost(selected.prompt, "") +
      ttsCallCost(TTS_MODEL, MAX_TUTOR_REPLY_CHARS);
    const preflight = reserveSpend(
      db,
      { model: TERRA_MODEL, contentHash: `tutor-preflight:${tutorId}`, costUsd: preflightCost },
      settings.monthlyBudgetUsd,
    );
    if (!preflight) {
      return NextResponse.json(
        {
          error: {
            code: "budget",
            message: "The monthly budget cannot cover one bounded transcript turn. No conversation was started.",
          },
          notice: "budget",
        },
        { status: 402 },
      );
    }
    openConversation(db, tutorId, minSeconds);
    releaseReservation(db, preflight);
    return NextResponse.json({
      tutorId,
      architecture,
      preset,
      promptHash: selected.promptHash,
      model: TERRA_MODEL,
      minSeconds,
      targets: selected.targets,
    });
  }

  // Reserve-before-call: no native session opens over the cap, and no token is minted.
  const lease = openTutorLease(db, tutorId, config.model, minutes, settings.monthlyBudgetUsd);
  if (!lease) {
    return NextResponse.json(
      {
        error: {
          code: "budget",
          message: `A conversation is estimated at ${estimateUsd.toFixed(2)} USD, which would exceed the monthly budget. No conversation was started.`,
        },
        // The sentence above is true and the gate confirmed it; what it had was no way
        // forward at all. The notice carries the remedy and the link that resolves.
        notice: "budget",
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
      // [v0.7 close sweep] This branch used to collapse EVERY failure-with-a-key into
      // "could not reach the conversation service just now. Try again in a moment." —
      // so a rotated or revoked key, which is standing until the operator edits a file
      // and restarts, invited an unbounded retry and named no remedy. E-44 had already
      // written the `key-rejected` notice; the tutor simply never adopted it. It does
      // now, through the one classifier every surface shares.
      const notice = classifyFailure({
        keyConfigured: Boolean(process.env.OPENAI_API_KEY),
        message: err.message,
        transient: "conversation-transient",
      });
      return NextResponse.json(
        { error: { code: "tutor_unavailable", message: noticeFor(notice).body }, notice },
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
    architecture,
    preset,
    promptHash,
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
