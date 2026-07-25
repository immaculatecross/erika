/**
 * A message a person can act on, never an internal error string. RETRO-004 §1: the
 * only place a new user learned that a key is required was a leaked internal error on
 * exactly this screen.
 */
export function startFailureMessage(err: unknown, info: { keyConfigured: boolean } | null): string {
  const name = (err as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Erika needs microphone access to hear you. Allow it in your browser and start again.";
  }
  if (name === "NotFoundError") {
    return "No microphone was found. Connect one and start again.";
  }
  if (info && !info.keyConfigured) {
    return "Erika needs an OpenAI API key to hold a conversation.";
  }
  const message = (err as Error)?.message;
  return typeof message === "string" && message.length > 0
    ? message
    : "Erika could not start a conversation just now. Try again in a moment.";
}
