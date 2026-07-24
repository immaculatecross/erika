import type { RealtimeSessionConfig } from "./session-config";

// The ephemeral client-secret minter (E-34) — the secret-exposure boundary, the
// never-waivable class. The browser connects to the Realtime API over WebRTC with a
// SHORT-LIVED ephemeral client secret ONLY; the real `OPENAI_API_KEY` is used HERE,
// server-side, to mint that ephemeral secret and is NEVER sent to the client.
//
// Everything network-shaped is isolated behind the `ClientSecretMinter` seam, the
// same discipline as lib/analysis/audio-model.ts and lib/render/tts-model.ts (D-10,
// D-13): the mint route, the money lease, and the "key never in the browser" test
// all run against a mock; no CI test makes a real call. The live WebRTC call is an
// operator-gated follow-up (needs a key AND the proxy to allowlist api.openai.com).
//
// The real minter reads the key from the environment at call time and never logs it;
// with no key it throws `MinterUnavailableError` so the mint route refuses truthfully
// and mints nothing — the tutor cannot open without the server principal's key.

/** A minted ephemeral client secret. `value` is the ONLY credential the browser
 *  ever receives (an `ek_…` secret, ~60 s TTL); `expiresAt` is epoch seconds. */
export interface EphemeralClientSecret {
  value: string;
  expiresAt: number;
}

/** The seam the mint route depends on. The real impl calls OpenAI; tests mock it. */
export interface ClientSecretMinter {
  mint(config: RealtimeSessionConfig): Promise<EphemeralClientSecret>;
}

/** Thrown when the minter has no server key or the endpoint is unavailable. */
export class MinterUnavailableError extends Error {}

const CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";

/**
 * The EXPLICIT allowlist of session fields OpenAI recognizes on
 * `POST /v1/realtime/client_secrets`. Verified against the live OpenAI Realtime
 * `client_secrets` / RealtimeSessionCreateRequest schema (2026-07-24): the recognized
 * session fields are `type, model, instructions, audio, tools, tool_choice` (the GA
 * schema also allows `output_modalities`/`max_output_tokens`, which this tutor config
 * does not set). The endpoint **400s on any unknown param**, so the mint body is built
 * from THIS allowlist — NOT by spreading the internal config — so no internal-only
 * field can ride along. In particular `maxSessionSeconds` is deliberately NOT an OpenAI
 * wire field: it is an INTERNAL, server-only value that OpenAI has no parameter for.
 * It is enforced entirely by us — the heartbeat route
 * (`app/api/tutor/session/[id]/heartbeat`) refuses with `covered: false` / 402 once the
 * SERVER-tracked elapsed time passes `maxTutorSessionSeconds()` ([T2b]), which is a
 * separate bound from the spend cap that `lib/tutor/money.ts` holds. Sending it to
 * OpenAI enforced nothing and is exactly the 400 that broke the tutor (OBS-001), so it
 * must NEVER reach the wire.
 */
export const MINT_SESSION_WIRE_FIELDS = [
  "type",
  "model",
  "instructions",
  "audio",
  "tools",
  "tool_choice",
] as const;

/** The wire shape of the mint's `session` object: only the OpenAI-recognized fields. */
export type MintSessionWireBody = Pick<RealtimeSessionConfig, (typeof MINT_SESSION_WIRE_FIELDS)[number]>;

/**
 * Build the mint request's `session` object from ONLY the allowlisted, OpenAI-recognized
 * fields. Pure and side-effect-free, so the wire contract is unit-testable without a
 * real fetch. Constructs the object explicitly from the allowlist rather than spreading
 * `config`, so an internal-only field added to `RealtimeSessionConfig` can never silently
 * leak onto the wire.
 */
export function buildMintSessionWireBody(config: RealtimeSessionConfig): MintSessionWireBody {
  const wire = {} as Record<(typeof MINT_SESSION_WIRE_FIELDS)[number], unknown>;
  for (const field of MINT_SESSION_WIRE_FIELDS) wire[field] = config[field];
  return wire as MintSessionWireBody;
}

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new MinterUnavailableError("OPENAI_API_KEY is not set (the tutor needs the server principal's key).");
  return key;
}

/**
 * The production minter. POSTs the session config to `/v1/realtime/client_secrets`
 * with the real API key (server-side only) and returns just the ephemeral secret +
 * its expiry. The real key never leaves this function; nothing here is returned to
 * the caller except the ephemeral value.
 */
export const openAiClientSecretMinter: ClientSecretMinter = {
  async mint(config) {
    let res: Response;
    try {
      res = await fetch(CLIENT_SECRETS_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey()}` },
        // Only the OpenAI-recognized session fields reach the wire — internal-only
        // fields (e.g. maxSessionSeconds) are stripped by the allowlist builder, so
        // the mint cannot 400 on an unknown param (OBS-001).
        body: JSON.stringify({ session: buildMintSessionWireBody(config) }),
      });
    } catch (err) {
      throw new MinterUnavailableError(`Network error minting client secret: ${(err as Error).message}`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new MinterUnavailableError(`client_secrets mint failed: ${res.status} ${res.statusText} ${body}`.trim());
    }
    const data = (await res.json()) as { value?: string; expires_at?: number };
    if (!data.value) throw new MinterUnavailableError("client_secrets response carried no ephemeral value.");
    return { value: data.value, expiresAt: data.expires_at ?? Math.floor(Date.now() / 1000) + 60 };
  },
};
