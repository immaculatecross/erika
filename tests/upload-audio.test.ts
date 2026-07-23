import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The one client upload contract (E-24 criterion 4): uploadAudio is the single
// entry both the file picker and the mic recorder use. tus is the primary path;
// the streamed POST /api/sessions is the automatic fallback. tus-js-client is a
// browser lib, so it is mocked here to drive each branch: success, a definitive
// file rejection (surfaced, not retried), a transport failure (falls back), and
// tus unsupported (straight to the fallback).

const state = vi.hoisted(() => ({
  supported: true,
  behavior: "success" as "success" | "reject" | "transport-fail",
}));

vi.mock("tus-js-client", () => ({
  get isSupported() {
    return state.supported;
  },
  Upload: class {
    options: {
      onSuccess: () => void;
      onError: (e: unknown) => void;
    };
    constructor(_file: unknown, options: typeof this.options) {
      this.options = options;
    }
    findPreviousUploads() {
      return Promise.resolve([]);
    }
    resumeFromPreviousUpload() {}
    start() {
      if (state.behavior === "success") return this.options.onSuccess();
      if (state.behavior === "reject") {
        return this.options.onError({
          originalResponse: {
            getStatus: () => 415,
            getBody: () => JSON.stringify({ error: { code: "unsupported_format", message: "Unsupported format." } }),
          },
        });
      }
      // transport failure: a network error with no HTTP response
      return this.options.onError(new Error("network down"));
    }
  },
}));

let uploadAudio: typeof import("@/lib/upload-audio").uploadAudio;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  state.supported = true;
  state.behavior = "success";
  uploadAudio = (await import("@/lib/upload-audio")).uploadAudio;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("uploadAudio — tus primary, streamed fallback", () => {
  it("uses tus and does NOT touch the streamed endpoint on success", async () => {
    const result = await uploadAudio("clip.wav", new Blob(["x"]));
    expect(result).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a definitive file rejection truthfully and does not fall back", async () => {
    state.behavior = "reject";
    const result = await uploadAudio("notes.txt", new Blob(["x"]));
    expect(result).toEqual({ ok: false, message: "Unsupported format." });
    expect(fetchMock).not.toHaveBeenCalled(); // a 415 is final — no re-upload
  });

  it("falls back to the streamed POST when the tus transport fails", async () => {
    state.behavior = "transport-fail";
    fetchMock.mockResolvedValue(jsonResponse(201, { id: "s1" }));
    const result = await uploadAudio("clip.wav", new Blob(["x"]));
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/sessions");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as { headers: Record<string, string> }).headers["x-filename"]).toBe("clip.wav");
  });

  it("goes straight to the streamed POST when tus is unsupported", async () => {
    state.supported = false;
    fetchMock.mockResolvedValue(jsonResponse(201, { id: "s1" }));
    const result = await uploadAudio("clip.wav", new Blob(["x"]));
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("reads the boundary error envelope from a failed streamed fallback", async () => {
    state.supported = false;
    fetchMock.mockResolvedValue(jsonResponse(413, { error: { code: "too_large", message: "File exceeds the limit." } }));
    const result = await uploadAudio("big.wav", new Blob(["x"]));
    expect(result).toEqual({ ok: false, message: "File exceeds the limit." });
  });
});
