import type { Db } from "../db";
import {
  finalizeReservation,
  reserveSpend,
  type SpendReservation,
} from "../analysis/budget";
import {
  TERRA_MODEL,
  TUTOR_STT_MODEL,
  sttCallCost,
  terraReservationCost,
  terraUsageCost,
  type TerraUsage,
} from "../analysis/rates";

export function transcriptTurnStarted(db: Db, tutorId: string, seq: string): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 FROM spend_ledger WHERE content_hash = ? LIMIT 1")
      .get(`tutor-stt:${tutorId}:${seq}`),
  );
}

export function reserveTranscriptLeg(
  db: Db,
  input: {
    tutorId: string;
    seq: string;
    durationSeconds: number;
    budgetUsd: number;
  },
): SpendReservation | null {
  if (transcriptTurnStarted(db, input.tutorId, input.seq)) return null;
  return reserveSpend(
    db,
    {
      model: TUTOR_STT_MODEL,
      contentHash: `tutor-stt:${input.tutorId}:${input.seq}`,
      costUsd: sttCallCost(TUTOR_STT_MODEL, input.durationSeconds),
    },
    input.budgetUsd,
  );
}

export function settleTranscriptLeg(
  db: Db,
  reservation: SpendReservation,
  durationSeconds: number,
): number {
  const cost = Math.min(
    reservation.costUsd,
    sttCallCost(TUTOR_STT_MODEL, durationSeconds),
  );
  finalizeReservation(db, reservation, cost);
  return cost;
}

export function reserveTerraLeg(
  db: Db,
  input: {
    tutorId: string;
    seq: string;
    prompt: string;
    context: string;
    budgetUsd: number;
    repair: boolean;
  },
): SpendReservation | null {
  return reserveSpend(
    db,
    {
      model: TERRA_MODEL,
      contentHash: `tutor-terra:${input.tutorId}:${input.seq}${input.repair ? ":repair" : ""}`,
      costUsd: terraReservationCost(input.prompt, input.context),
    },
    input.budgetUsd,
  );
}

export function settleTerraLeg(
  db: Db,
  reservation: SpendReservation,
  usage: TerraUsage,
): number {
  const cost = Math.min(reservation.costUsd, terraUsageCost(usage).totalUsd);
  finalizeReservation(db, reservation, cost);
  return cost;
}
