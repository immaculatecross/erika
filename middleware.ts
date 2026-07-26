import { NextResponse, type NextRequest } from "next/server";
import { LOCAL_PRINCIPAL, PRINCIPAL_HEADER } from "@/lib/auth/principal";
import { PATHNAME_HEADER } from "@/lib/onboarding/routing";

// The no-op auth middleware (E-24, D-25). It stamps the single-user principal on
// every request so server code reads identity from exactly one place
// (`getPrincipal` in lib/auth/principal.ts) instead of assuming it. It is
// genuinely no-op: it always stamps the same local principal, runs no auth
// check, and blocks nothing. E-40 turns this seam into real hosting.
//
// [E-46] It also stamps the requested PATHNAME, because the root layout — where
// the first-run gate lives — cannot otherwise see which URL it is rendering.
// The gate is NOT here: it needs the database, and middleware runs in the Edge
// runtime where `better-sqlite3` (a native module) cannot be loaded. So this
// stays a pure header stamp and app/layout.tsx does the deciding.

export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set(PRINCIPAL_HEADER, LOCAL_PRINCIPAL.id);
  headers.set(PATHNAME_HEADER, request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

// Every request except Next's own static assets — the principal is stamped
// app-wide, not only on /api, so the seam is uniform when E-40 needs it.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
