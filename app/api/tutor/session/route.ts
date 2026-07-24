import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readSettings } from "@/lib/settings";
import { monthToDateSpend } from "@/lib/analysis/budget";
import { realtimeModelForTier } from "@/lib/analysis/rates";
import { buildTutorSessionConfig } from "@/lib/tutor/session-config";
import { openTutorLease, releaseTutorLease, defaultTutorMinutes, estimateTutorSessionUsd } from "@/lib/tutor/money";
import { openAiClientSecretMinter, MinterUnavailableError } from "@/lib/tutor/mint";

// The tutor session's mint + lease route (E-34). The secret-exposure + spend
// boundary, both never-waivable.
//
//   GET  — the pre-call estimate: the per-session cost, month-to-date spend, the cap,
//          and the remaining budget. No side effects (D-25: a GET records nothing).
//   POST — OPEN a session: reserve the estimate against the cap (a truthful refusal at
//          the cap opens NOTHING and mints NO token), then mint a short-lived
//          EPHEMERAL client secret server-side. The response carries ONLY the ephemeral
//          secret + the session config the browser needs — the real OPENAI_API_KEY is
//          used only inside the minter and never reaches the client (WO criteria 1, 5).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const db = getDb();
  const settings = readSettings(db);
  const model = realtimeModelForTier(settings.realtimeTier);
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
  });
}

export async function POST() {
  const db = getDb();
  const settings = readSettings(db);
  const minutes = defaultTutorMinutes();
  const { config, targets } = buildTutorSessionConfig(db);
  const estimateUsd = estimateTutorSessionUsd(config.model, minutes);

  // Reserve-before-call: no session opens over the cap, and no token is minted.
  const tutorId = randomUUID();
  const lease = openTutorLease(db, tutorId, config.model, minutes, settings.monthlyBudgetUsd);
  if (!lease) {
    return NextResponse.json(
      {
        error: {
          code: "budget",
          message: `A tutor session is estimated at ${estimateUsd.toFixed(2)} USD, which would exceed the monthly budget. No session was opened.`,
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
        { error: { code: "tutor_unavailable", message: err.message } },
        { status: 503 },
      );
    }
    throw err;
  }

  return NextResponse.json({
    tutorId,
    // The ONLY credential the browser receives — the short-lived ephemeral secret.
    clientSecret: secret.value,
    expiresAt: secret.expiresAt,
    model: config.model,
    estimateUsd,
    minutes,
    // The session config the browser applies over WebRTC (instructions + tools +
    // voice). It carries NO key.
    session: config,
    targets,
  });
}
