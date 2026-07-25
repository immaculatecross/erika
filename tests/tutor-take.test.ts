import { describe, expect, it, vi } from "vitest";
import { UPLOAD_FORMAT } from "@/lib/recording";
import { CONVERSATION_TAKE_LOST, landConversationTake } from "@/lib/tutor/take";
import { closingLine } from "@/lib/tutor/closing-line";

// THE CONVERSATION STILL BECOMES A SESSION (E-43 criterion 5, E-17).
//
// This is the criterion the E-43 browser walk found FALSE while 1 238 tests were
// green: the tutor uploaded its raw MediaRecorder container, which carries no duration,
// and the finalize gate refused every one with 422 `undecodable_audio`. Two versions of
// the tutor shipped that way. No unit test could see it because no unit test uploads a
// real MediaRecorder blob — which is exactly why the fix comes with a test of the
// SEQUENCE (convert, then name, then upload) rather than of the blob.

const CAPTURED = new Date("2026-07-25T08:10:00.000Z");

function fakes(overrides: Partial<Parameters<typeof landConversationTake>[0]> = {}) {
  const uploads: { filename: string; bytes: number; capturedAt?: string }[] = [];
  const deps = {
    blob: new Blob([new Uint8Array(4_000)], { type: "audio/webm;codecs=opus" }),
    capturedAt: CAPTURED,
    toWav: vi.fn(async () => new Blob([new Uint8Array(9_000)], { type: "audio/wav" })),
    upload: vi.fn(async (filename: string, body: Blob, capture: { capturedAt?: string }) => {
      uploads.push({ filename, bytes: body.size, capturedAt: capture.capturedAt });
      return { ok: true as const };
    }),
    ...overrides,
  };
  return { deps, uploads };
}

describe("the take is converted before it is uploaded", () => {
  it("uploads WAV, not the raw recorder container", async () => {
    const { deps, uploads } = fakes();
    expect(await landConversationTake(deps)).toEqual({ kind: "uploaded" });
    expect(deps.toWav).toHaveBeenCalledTimes(1);
    expect(uploads).toHaveLength(1);
    expect(uploads[0].filename.endsWith(`.${UPLOAD_FORMAT}`)).toBe(true);
    expect(uploads[0].filename.endsWith(".webm")).toBe(false);
    // …and it is the CONVERTED bytes that go up, not the original blob.
    expect(uploads[0].bytes).toBe(9_000);
  });

  it("declares when the learner SPOKE, not when the upload happened (E-42's v28 column)", async () => {
    const { deps, uploads } = fakes();
    await landConversationTake(deps);
    expect(uploads[0].capturedAt).toBe(CAPTURED.toISOString());
  });

  it("names the file for the moment the conversation began", async () => {
    const { deps, uploads } = fakes();
    await landConversationTake(deps);
    expect(uploads[0].filename).toContain("2026-07-25");
  });
});

describe("nothing is lost silently", () => {
  it("says so out loud when the browser cannot decode its own recording", async () => {
    const { deps, uploads } = fakes({
      toWav: vi.fn(async () => {
        throw new Error("decodeAudioData failed");
      }),
    });
    expect(await landConversationTake(deps)).toEqual({ kind: "lost", message: CONVERSATION_TAKE_LOST });
    expect(uploads).toHaveLength(0);
  });

  it("treats an empty conversion as a lost take, not a successful upload of nothing", async () => {
    const { deps, uploads } = fakes({ toWav: vi.fn(async () => new Blob([])) });
    expect((await landConversationTake(deps)).kind).toBe("lost");
    expect(uploads).toHaveLength(0);
  });

  it("passes the server's own refusal through, rather than a generic failure", async () => {
    const { deps } = fakes({
      upload: vi.fn(async () => ({ ok: false as const, message: "Unsupported format. Accepted: wav, mp3." })),
    });
    expect(await landConversationTake(deps)).toEqual({
      kind: "refused",
      message: "Unsupported format. Accepted: wav, mp3.",
    });
  });

  it("never throws, so the money and the conversation record still close", async () => {
    const { deps } = fakes({
      upload: vi.fn(async () => {
        throw new Error("network gone");
      }),
    });
    await expect(landConversationTake(deps)).resolves.toMatchObject({ kind: "refused" });
  });

  it("an empty recording is 'empty', which is not a failure and not an upload", async () => {
    const { deps, uploads } = fakes({ blob: null });
    expect(await landConversationTake(deps)).toEqual({ kind: "empty" });
    expect(uploads).toHaveLength(0);
    expect(deps.toWav).not.toHaveBeenCalled();
  });
});

describe("the closing line is factual, and D-24 holds", () => {
  it("acknowledges a conversation that counted, once", () => {
    expect(closingLine(true, { kind: "uploaded" })).toBe(
      "That conversation counts toward today. Erika is listening back to it now.",
    );
  });

  it("says NOTHING about falling short when the minimum was not reached", () => {
    // "No countdown, no warning, no guilt copy if the learner leaves early" (D-24).
    const line = closingLine(false, { kind: "uploaded" });
    expect(line).not.toMatch(/short|not enough|didn't|failed|missed|next time|almost|only/i);
    expect(line).toBe("Erika is listening back to it now.");
  });

  it("tells the learner when the recording did NOT land, whatever else happened", () => {
    for (const met of [true, false]) {
      expect(closingLine(met, { kind: "lost", message: CONVERSATION_TAKE_LOST })).toBe(CONVERSATION_TAKE_LOST);
      expect(closingLine(met, { kind: "refused", message: "Upload failed." })).toBe("Upload failed.");
    }
  });

  it("never celebrates: no confetti, badge, streak or exclamation of praise", () => {
    for (const met of [true, false]) {
      for (const take of [{ kind: "uploaded" } as const, { kind: "empty" } as const]) {
        expect(closingLine(met, take)).not.toMatch(/great|well done|amazing|congrat|🎉|badge|streak|XP/i);
      }
    }
  });
});
