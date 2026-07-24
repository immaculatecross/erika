import type { SpeakerEmbedder } from "./embedder";
import { readWindowSamples, EMBED_SAMPLE_RATE } from "./pcm";

// The in-sandbox speaker embedder (E-36, D-13). A deterministic, dependency-free
// acoustic feature: ffmpeg decodes the window (lib/speaker/pcm.ts) and this module
// computes a mean-normalized LOG-MEL FILTERBANK vector — the spectral envelope that
// captures a voice's formant structure, the classic precursor to MFCC/x-vector
// features. It is not a learned speaker model, but it genuinely discriminates two
// voices well enough to CALIBRATE the recall-first threshold end to end in the
// sandbox, which sherpa-onnx cannot (no egress, no model). sherpa is the quality
// upgrade behind the same `SpeakerEmbedder` interface (lib/speaker/sherpa-embedder.ts).
//
// Pipeline: 25 ms Hann frames @ 10 ms hop → 512-pt real FFT → power spectrum →
// `MEL_BANDS` triangular mel filters (0…8 kHz) → log energy → average across frames
// → subtract the per-vector mean (a cepstral-mean-style channel normalization, so a
// flat gain/level offset does not move the vector) → L2 normalize. The result is a
// unit vector; cosine similarity then compares two windows.

export const MEL_BANDS = 26;
const FRAME_MS = 25;
const HOP_MS = 10;
const FFT_SIZE = 512;
const MEL_MAX_HZ = 8000;

/** The default in-sandbox embedder. Always available (ffmpeg is a D-7 prerequisite). */
export const spectralEmbedder: SpeakerEmbedder = {
  id: "spectral-logmel-v1",
  isAvailable() {
    return true;
  },
  async embed(wavPath, startMs, endMs) {
    const samples = await readWindowSamples(wavPath, startMs, endMs, EMBED_SAMPLE_RATE);
    return logMelEmbedding(samples, EMBED_SAMPLE_RATE);
  },
};

/**
 * Compute the mean-normalized log-mel vector for a mono sample buffer. Pure and
 * synchronous so it is unit-testable without audio I/O. Returns a zero vector for a
 * buffer too short to hold a single frame (the caller reads that as no similarity).
 */
export function logMelEmbedding(samples: Float32Array, sampleRate: number): Float32Array {
  const frameLen = Math.round((FRAME_MS / 1000) * sampleRate);
  const hop = Math.round((HOP_MS / 1000) * sampleRate);
  const filters = melFilterbank(MEL_BANDS, FFT_SIZE, sampleRate);
  const hann = hannWindow(frameLen);

  const acc = new Float64Array(MEL_BANDS);
  let frames = 0;
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);

  for (let start = 0; start + frameLen <= samples.length; start += hop) {
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < frameLen; i++) re[i] = samples[start + i] * hann[i];
    fft(re, im);
    // Power spectrum over the first half (real signal → symmetric).
    for (let b = 0; b < MEL_BANDS; b++) {
      let energy = 0;
      const filt = filters[b];
      for (let k = 0; k < filt.length; k++) {
        const bin = filt[k].bin;
        const power = re[bin] * re[bin] + im[bin] * im[bin];
        energy += power * filt[k].weight;
      }
      acc[b] += Math.log(energy + 1e-10);
    }
    frames++;
  }

  const out = new Float32Array(MEL_BANDS);
  if (frames === 0) return out;
  let mean = 0;
  for (let b = 0; b < MEL_BANDS; b++) {
    acc[b] /= frames;
    mean += acc[b];
  }
  mean /= MEL_BANDS;
  // Cepstral-mean-style channel normalization: subtract the vector mean so an
  // overall level/gain shift (a louder mic, a quieter room) does not rotate the
  // vector — only the SHAPE of the envelope (the speaker's formants) remains.
  let norm = 0;
  for (let b = 0; b < MEL_BANDS; b++) {
    const v = acc[b] - mean;
    out[b] = v;
    norm += v * v;
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let b = 0; b < MEL_BANDS; b++) out[b] /= norm;
  }
  return out;
}

/** A Hann window of length n. */
function hannWindow(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

/** Hz → mel (HTK formula). */
function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}
/** mel → Hz (inverse HTK). */
function melToHz(mel: number): number {
  return 700 * (10 ** (mel / 2595) - 1);
}

interface FilterTap {
  bin: number;
  weight: number;
}

/** Triangular mel filterbank as a sparse (bin, weight) list per band. */
function melFilterbank(bands: number, fftSize: number, sampleRate: number): FilterTap[][] {
  const nyquistBins = fftSize / 2;
  const melMax = hzToMel(Math.min(MEL_MAX_HZ, sampleRate / 2));
  // bands+2 equally-spaced mel points bound bands triangular filters.
  const points: number[] = [];
  for (let i = 0; i < bands + 2; i++) {
    const hz = melToHz((melMax * i) / (bands + 1));
    points.push(Math.floor(((fftSize + 1) * hz) / sampleRate));
  }
  const filters: FilterTap[][] = [];
  for (let b = 1; b <= bands; b++) {
    const left = points[b - 1];
    const center = points[b];
    const right = points[b + 1];
    const taps: FilterTap[] = [];
    for (let bin = left; bin <= right && bin <= nyquistBins; bin++) {
      if (bin < 0) continue;
      let weight = 0;
      if (bin < center && center > left) weight = (bin - left) / (center - left);
      else if (bin >= center && right > center) weight = (right - bin) / (right - center);
      if (weight > 0) taps.push({ bin, weight });
    }
    filters.push(taps);
  }
  return filters;
}

/**
 * In-place iterative radix-2 Cooley–Tukey FFT (n must be a power of two).
 * Dependency-free — a learned model is the sherpa upgrade, but the spectral feature
 * needs only a plain DFT, and a committed 60-line FFT keeps the sandbox path honest.
 */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = i + k + len / 2;
        const tRe = re[b] * curRe - im[b] * curIm;
        const tIm = re[b] * curIm + im[b] * curRe;
        re[b] = re[a] - tRe;
        im[b] = im[a] - tIm;
        re[a] += tRe;
        im[a] += tIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}
