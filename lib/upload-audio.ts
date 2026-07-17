// The one client-side path to the ingestion endpoint (E-2 part 1's fixed
// contract): POST /api/sessions with the raw bytes as the body and an
// x-filename header — never multipart, so the server streams to disk. Both the
// file-upload picker and the mic recorder funnel through here so the contract
// lives in exactly one place.

export type UploadResult = { ok: true } | { ok: false; message: string };

export async function uploadAudio(filename: string, body: BodyInit): Promise<UploadResult> {
  try {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "x-filename": encodeURIComponent(filename) },
      body,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, message: data.error ?? "Upload failed." };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: "Upload failed." };
  }
}
