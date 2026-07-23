import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { getPrincipal, LOCAL_PRINCIPAL, PRINCIPAL_HEADER } from "@/lib/auth/principal";

// The no-op auth seam (E-24 criterion 2). The middleware stamps a single-user
// principal on every request; getPrincipal is the one read point. It is
// genuinely no-op — it always resolves the same local principal and blocks
// nothing — but it exists so E-40 can make it real without a rename.

describe("getPrincipal — the single read point", () => {
  it("returns the principal the middleware stamped on the request", () => {
    const req = new Request("http://localhost/api/letter", {
      headers: { [PRINCIPAL_HEADER]: "local" },
    });
    expect(getPrincipal(req)).toEqual({ id: "local", kind: "local" });
  });

  it("still resolves the local principal when unstamped — it gates nothing", () => {
    const req = new Request("http://localhost/api/letter");
    expect(getPrincipal(req)).toEqual(LOCAL_PRINCIPAL);
    expect(LOCAL_PRINCIPAL).toEqual({ id: "local", kind: "local" });
  });
});

describe("middleware — stamps the principal on every request", () => {
  it("forwards the request with the principal header set", () => {
    const res = middleware(new NextRequest("http://localhost/api/letter"));
    // NextResponse.next({ request: { headers } }) exposes the overridden request
    // header as `x-middleware-request-<name>` — the value the route will read.
    expect(res.headers.get(`x-middleware-request-${PRINCIPAL_HEADER}`)).toBe("local");
  });

  it("does not block or redirect — no auth check today", () => {
    const res = middleware(new NextRequest("http://localhost/api/letter"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});
