import { getTusServer } from "@/lib/tus-server";

// The tus resumable-upload endpoint (E-24, D-25). A catch-all so the tus
// protocol's per-upload URLs (/api/upload/<id>) resolve here alongside the
// creation POST to /api/upload. Every method is delegated whole to the tus
// Server (lib/tus-server.ts), which owns the protocol, the data/uploads/ store,
// the shared finalize on completion, and the partial-upload GC. Node runtime —
// the store writes to the filesystem; never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function handle(request: Request): Promise<Response> {
  return getTusServer().handleWeb(request);
}

export {
  handle as POST,
  handle as HEAD,
  handle as PATCH,
  handle as DELETE,
  handle as OPTIONS,
  handle as GET,
};
