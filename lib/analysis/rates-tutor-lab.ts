export const TERRA_MODEL = "gpt-5.6-terra" as const;
export type TerraModelId = typeof TERRA_MODEL;

export interface TerraRate {
  usdPerInputToken: number;
  usdPerCachedInputToken: number;
  usdPerCacheWriteToken: number;
  usdPerOutputToken: number;
}

/** Official short-context standard prices, retrieved 2026-07-26. The tutor's bounded
 * prompt is far below the 272k long-context threshold. Reasoning tokens bill as output. */
export const TERRA_RATES: Record<TerraModelId, TerraRate> = {
  "gpt-5.6-terra": {
    usdPerInputToken: 2.5 / 1_000_000,
    usdPerCachedInputToken: 0.25 / 1_000_000,
    usdPerCacheWriteToken: 3.125 / 1_000_000,
    usdPerOutputToken: 15 / 1_000_000,
  },
};

export const TERRA_MAX_OUTPUT_TOKENS = 1600;

export interface TerraUsage {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export interface TerraCostBreakdown {
  inputUsd: number;
  cachedInputUsd: number;
  cacheWriteUsd: number;
  outputUsd: number;
  reasoningTokens: number;
  totalUsd: number;
}

export function terraUsageCost(
  usage: TerraUsage,
  model: TerraModelId = TERRA_MODEL,
): TerraCostBreakdown {
  const rate = TERRA_RATES[model];
  const cached = Math.max(0, usage.cachedInputTokens);
  const cacheWrite = Math.max(0, usage.cacheWriteTokens);
  const input = Math.max(0, usage.inputTokens - cached - cacheWrite);
  const output = Math.max(0, usage.outputTokens);
  const inputUsd = input * rate.usdPerInputToken;
  const cachedInputUsd = cached * rate.usdPerCachedInputToken;
  const cacheWriteUsd = cacheWrite * rate.usdPerCacheWriteToken;
  const outputUsd = output * rate.usdPerOutputToken;
  return {
    inputUsd,
    cachedInputUsd,
    cacheWriteUsd,
    outputUsd,
    reasoningTokens: Math.max(0, usage.reasoningTokens),
    totalUsd: inputUsd + cachedInputUsd + cacheWriteUsd + outputUsd,
  };
}

/** Pre-call reservation: all prompt tokens at the dearer cache-write price and the
 * full output ceiling at the output price. Over-booking is the safe direction. */
export function terraReservationCost(prompt: string, context: string): number {
  const rate = TERRA_RATES[TERRA_MODEL];
  const inputTokens = Math.ceil(`${prompt}\n${context}`.length / 4);
  return inputTokens * rate.usdPerCacheWriteToken + TERRA_MAX_OUTPUT_TOKENS * rate.usdPerOutputToken;
}
