"use client";

export interface TutorPlayback {
  firstAudioMs: number;
  bytes: number;
  modelledCostUsd: number;
  finished: Promise<void>;
}

function append(source: SourceBuffer, chunk: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      source.removeEventListener("updateend", done);
      source.removeEventListener("error", failed);
      resolve();
    };
    const failed = () => {
      source.removeEventListener("updateend", done);
      source.removeEventListener("error", failed);
      reject(new Error("The browser could not buffer the tutor audio."));
    };
    source.addEventListener("updateend", done, { once: true });
    source.addEventListener("error", failed, { once: true });
    source.appendBuffer(chunk.slice().buffer);
  });
}

function sourceOpened(source: MediaSource): Promise<void> {
  if (source.readyState === "open") return Promise.resolve();
  return new Promise((resolve) => {
    source.addEventListener("sourceopen", () => resolve(), { once: true });
  });
}

function audioEnded(audio: HTMLAudioElement): Promise<void> {
  return new Promise((resolve) => {
    if (audio.ended) resolve();
    else audio.addEventListener("ended", () => resolve(), { once: true });
  });
}

/** Play the same MP3 stream for both listener architectures. The first provider
 * chunk is appended and played before the remaining response has arrived. */
export async function playTutorSpeechStream(
  response: Response,
  audio: HTMLAudioElement = new Audio(),
): Promise<TutorPlayback> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? "Erika could not speak that reply.");
  }
  if (!response.body) throw new Error("The speech response carried no audio stream.");
  const started = performance.now();
  const modelledCostUsd = Number(response.headers.get("x-tutor-cost-usd")) || 0;

  if (
    typeof MediaSource === "undefined" ||
    !MediaSource.isTypeSupported("audio/mpeg")
  ) {
    const blob = await response.blob();
    audio.src = URL.createObjectURL(blob);
    await audio.play();
    return {
      firstAudioMs: performance.now() - started,
      bytes: blob.size,
      modelledCostUsd,
      finished: audioEnded(audio).finally(() => URL.revokeObjectURL(audio.src)),
    };
  }

  const media = new MediaSource();
  const url = URL.createObjectURL(media);
  audio.src = url;
  const reader = response.body.getReader();
  await sourceOpened(media);
  const buffer = media.addSourceBuffer("audio/mpeg");
  const first = await reader.read();
  if (first.done || !first.value?.byteLength) {
    URL.revokeObjectURL(url);
    throw new Error("The speech response carried no audio bytes.");
  }
  let bytes = first.value.byteLength;
  await append(buffer, first.value);

  // A provider delta can be smaller than one decodable MP3 frame. Start play
  // while continuing to append; awaiting play before pumping creates a
  // deadlock whenever the first delta alone cannot advance the audio element.
  const playing = audio.play();
  const pumping = (async () => {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      await append(buffer, next.value);
    }
    if (media.readyState === "open") media.endOfStream();
  })();
  // Keep a fast pump failure handled while play is still waiting for enough
  // bytes; `finished` below remains the authoritative rejection path.
  void pumping.catch(() => {});
  await playing;
  const firstAudioMs = performance.now() - started;

  const finished = pumping.then(async () => {
    await audioEnded(audio);
  }).finally(() => URL.revokeObjectURL(url));

  return {
    firstAudioMs,
    get bytes() {
      return bytes;
    },
    modelledCostUsd,
    finished,
  };
}
