import { NextResponse, type NextRequest } from "next/server";
import { LOCAL_PRINCIPAL, PRINCIPAL_HEADER } from "@/lib/auth/principal";

// The no-op auth middleware (E-24, D-25). It stamps the single-user principal on
// every request so server code reads identity from exactly one place
// (`getPrincipal` in lib/auth/principal.ts) instead of assuming it. It is
// genuinely no-op: it always stamps the same local principal, runs no auth
// check, and blocks nothing. E-40 turns this seam into real hosting.

export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set(PRINCIPAL_HEADER, LOCAL_PRINCIPAL.id);
  return NextResponse.next({ request: { headers } });
}

// Every request except Next's own static assets — the principal is stamped
// app-wide, not only on /api, so the seam is uniform when E-40 needs it.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
