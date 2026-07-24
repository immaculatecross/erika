import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/error";
import { getDb } from "@/lib/db";
import { readSettings } from "@/lib/settings";
import { coerceRegister } from "@/lib/register";
import { ensurePronunciationDir, pronunciationTakePath, streamToFile, UploadTooLargeError } from "@/lib/audio-storage";
import { normalize } from "@/lib/ingest/normalize";
import { probeDuration } from "@/lib/ingest/ffmpeg";
import { getPhraseRender, phraseHash } from "@/lib/render/phrase-renders";
import { phraseRenderEstimateUsd } from "@/lib/render/phrase";
import {
  buildResultView,
  drillEstimateUsd,
  listAttemptsForDrill,
  pronunciationThresholds,
  resolveDrill,
  resolvePronunciationScorer,
  scoreAttempt,
  BudgetExceededError,
  DrillTooLongError,
  ScorerUnavailableError,
  PronunciationParseError,
  PronunciationScorerUnavailableError,
  MAX_DRILL_SECONDS,
  UNCALIBRATED_NOTICE,
  UNSCORED_NOTICE,
  whatToListenFor,
} from "@/lib/pronunciation";

// One pronunciation drill (E-37, D-21/D-18).
//
// GET  — what the drill page primes with: the CORRECT target phrase, whether its
//        native rendition already exists (the E-33 phrase-render cache — the SAME
//        rendition the shadow format uses, so no second TTS vendor and no second
//        render charge), the attempt history, and whether scoring can run here.
// POST — the learner's take: raw WAV bytes on the body. Normalized to 16 kHz mono
//        (Azure asks for ≥16 kHz), measured, then assessed through the seam with
//        reserve-before-call billing (lib/pronunciation/studio.ts).
//
// The scorer is RESOLVED here and PASSED IN — the orchestration never imports one.
// No secret is ever returned: the payload carries a boolean `available`, never a key.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ drillKey: string }> };

/** A drill take is one short sentence; 12 MB of 16 kHz mono WAV is ~6 minutes, far
 *  above the 30 s the assessment path accepts. A generous ceiling that still refuses
 *  a runaway upload before it touches the disk. */
const MAX_TAKE_BYTES = 12 * 1024 * 1024;

export async function GET(_request: Request, { params }: Ctx) {
  const { drillKey } = await params;
  const db = getDb();
  const drill = resolveDrill(db, drillKey);
  if (!drill) return apiError("drill_not_found", "That drill is no longer available.", 404);

  const register = coerceRegister(readSettings(db).register);
  const renditionExists = getPhraseRender(db, phraseHash(drill.referenceText, register)) !== null;
  const attempts = listAttemptsForDrill(db, drill.drillKey);
  const thresholds = pronunciationThresholds();

  return NextResponse.json({
    ...drill,
    register,
    /** What to listen for, with no scorer involved — the primary guidance (D-21: the
     *  LLM's read is a note, never a score). */
    guidance: whatToListenFor(drill),
    /** The native rendition is rendered through the E-33 shadow endpoints — the same
     *  cached phrase render, billed once, replayed free. */
    renditionExists,
    renditionEstimateUsd: phraseRenderEstimateUsd(drill.referenceText),
    /** Whether the OPTIONAL scoring layer can run here. False changes nothing about
     *  the listen → say-it-back loop; it only hides the priced scoring control. */
    scoringAvailable: resolvePronunciationScorer().isAvailable(),
    /** A modeled figure from rates.ts for a typical short take — never an invoice. */
    scoreEstimateUsd: drillEstimateUsd(Math.min(6, MAX_DRILL_SECONDS)),
    maxSeconds: MAX_DRILL_SECONDS,
    thresholds,
    unscoredNotice: UNSCORED_NOTICE,
    notice: UNCALIBRATED_NOTICE,
    attempts: attempts.map((a) => ({
      id: a.id,
      createdAt: a.createdAt,
      pronScore: a.pronScore,
      lowSnr: a.lowSnr,
      scorerId: a.scorerId,
      costUsd: a.costUsd,
    })),
  });
}

export async function POST(request: Request, { params }: Ctx) {
  const { drillKey } = await params;
  const db = getDb();
  const drill = resolveDrill(db, drillKey);
  if (!drill) return apiError("drill_not_found", "That drill is no longer available.", 404);
  if (!request.body) return apiError("empty_body", "Request body is empty.", 400);

  const scorer = resolvePronunciationScorer();
  if (!scorer.isAvailable()) {
    // The honest wall, checked before a single byte is stored: nothing is uploaded,
    // nothing is reserved, and no score is invented.
    return apiError(
      "scorer_unavailable",
      "Pronunciation scoring is not set up on this server — no Azure Speech key is configured.",
      503,
    );
  }

  const attemptAudioId = randomUUID();
  const staged = path.join(tmpdir(), `erika-drill-${attemptAudioId}.wav`);
  await ensurePronunciationDir();
  const takePath = pronunciationTakePath(attemptAudioId);

  try {
    try {
      await streamToFile(request.body as WebReadableStream<Uint8Array>, staged, MAX_TAKE_BYTES);
    } catch (err) {
      if (err instanceof UploadTooLargeError) {
        return apiError("take_too_large", "That recording is too large to assess.", 413);
      }
      throw err;
    }

    // Azure wants ≥16 kHz mono PCM; browsers hand us whatever the mic gave.
    await normalize(staged, takePath);
    const seconds = await probeDuration(takePath);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      await rm(takePath, { force: true });
      return apiError("take_unreadable", "That recording could not be read.", 400);
    }

    const { attempt } = await scoreAttempt(db, scorer, { drill, audioPath: takePath, audioSeconds: seconds });
    return NextResponse.json(
      {
        attemptId: attempt.id,
        createdAt: attempt.createdAt,
        costUsd: attempt.costUsd,
        scorerId: attempt.scorerId,
        view: buildResultView(attempt.result, pronunciationThresholds()),
      },
      { status: 201 },
    );
  } catch (err) {
    await rm(takePath, { force: true }).catch(() => {});
    if (err instanceof BudgetExceededError) {
      return apiError(
        "budget_exceeded",
        "Monthly budget reached — no take can be scored until it is raised or the month rolls over. Nothing was charged and nothing was scored.",
        402,
      );
    }
    if (err instanceof DrillTooLongError) {
      return apiError("take_too_long", `A take may be at most ${MAX_DRILL_SECONDS} seconds.`, 413);
    }
    if (err instanceof ScorerUnavailableError || err instanceof PronunciationScorerUnavailableError) {
      return apiError("scorer_unavailable", "The pronunciation scorer is unavailable right now.", 503);
    }
    if (err instanceof PronunciationParseError) {
      return apiError(
        "scorer_unreadable",
        "The scorer answered with something we could not read. The call was still charged and is recorded.",
        502,
      );
    }
    throw err;
  } finally {
    await rm(staged, { force: true }).catch(() => {});
  }
}
