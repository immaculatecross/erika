// The auth seam (E-24, D-25). Today Erika is single-user: every request belongs
// to the one local person, and nothing is gated. This module names that fact in
// one place so E-40 can make it real — a hosted, per-user principal — without a
// rename or a second read point.
//
// The shape is deliberate: `id` is the stable key a real backend will fill with
// a user id; `kind` widens later ("local" → "hosted" | "native" | …). The
// middleware (middleware.ts) stamps `PRINCIPAL_HEADER` on every request; a route
// reads it through `getPrincipal(request)` and nowhere else.

/** The request header the no-op middleware stamps with the principal id. */
export const PRINCIPAL_HEADER = "x-erika-principal";

/** Who a request belongs to. Single-user today; E-40 makes `kind` meaningful. */
export interface Principal {
  /** Stable identity key. Always the local user until hosting lands. */
  id: string;
  /** Origin of the identity. Only "local" exists now. */
  kind: "local";
}

/** The one principal that exists today — the local user, gated by nothing. */
export const LOCAL_PRINCIPAL: Principal = { id: "local", kind: "local" };

/**
 * The single read point for who a request belongs to. Reads the id the
 * middleware stamped; if the header is absent (a request that never passed
 * through middleware — e.g. a direct handler call) it still resolves the one
 * local principal, because this seam blocks nothing. E-40 replaces the body,
 * not the callers.
 */
export function getPrincipal(request: Request): Principal {
  const id = request.headers.get(PRINCIPAL_HEADER);
  return id ? { id, kind: "local" } : LOCAL_PRINCIPAL;
}
