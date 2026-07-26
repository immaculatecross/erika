import { createHash } from "node:crypto";

// Server-only prompt identity helper. Kept out of ./prompt-presets so the
// browser realtime client can import the pure prompt builders/constants without
// pulling node:crypto into the client bundle (Next UnhandledSchemeError).

/** Stable SHA-256 hex of a fully built tutor prompt — spend/identity on the server. */
export function tutorPromptHash(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex");
}
