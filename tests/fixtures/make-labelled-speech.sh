#!/bin/bash
# Regenerate tests/fixtures/labelled-speech.flac — the D-13 calibration sample.
#
# A synthetic tone-vs-silence fixture proves the VAD MECHANISM but can never
# falsify a THRESHOLD: a full-scale tone over digital silence is detected by any
# parameters at all. This sample is built to be falsifiable instead:
#
#   * quiet utterances (peak ≈ -21 dBFS) over a real pink-noise room floor
#     (≈ -60 dBFS), so an absolute threshold guess like the old fixed -30 dB
#     lands INSIDE the speech;
#   * 4.5 Hz syllabic amplitude modulation, so each utterance contains the
#     sub-second internal dips a narrow merge gap would chop it at;
#   * 60 ms onset/offset fades, so cutting at the detected edge clips real audio
#     unless there is pre/post-roll padding;
#   * two utterances under 2 s (1.6 s and 1.2 s), so an over-eager minimum
#     length discards genuine speech.
#
# The labelled spans live in labelled-speech.json and are asserted for RECALL by
# tests/ingest-vad-calibration.test.ts. Deterministic: fixed noise seed, fixed
# offsets — regenerating reproduces the same file.
set -euo pipefail
cd "$(dirname "$0")"

# $1 seconds  $2 f0 Hz  $3 amplitude
utterance() {
  echo "aevalsrc='$3*(0.55+0.45*sin(2*PI*4.5*t))*(sin(2*PI*$2*t)+0.55*sin(2*PI*$(($2 * 2))*t)+0.35*sin(2*PI*$(($2 * 4))*t)+0.18*sin(2*PI*$(($2 * 9))*t))':d=$1:s=16000"
}

ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i "$(utterance 2.4 130 0.055)" \
  -f lavfi -i "$(utterance 1.6 145 0.045)" \
  -f lavfi -i "$(utterance 3.0 120 0.060)" \
  -f lavfi -i "$(utterance 1.2 150 0.040)" \
  -f lavfi -i "$(utterance 2.0 135 0.050)" \
  -f lavfi -i "anoisesrc=c=pink:a=0.0035:d=17:r=16000:seed=42" \
  -filter_complex "\
[0:a]afade=t=in:d=0.06,afade=t=out:st=2.34:d=0.06,adelay=800|800[a0];\
[1:a]afade=t=in:d=0.06,afade=t=out:st=1.54:d=0.06,adelay=4200|4200[a1];\
[2:a]afade=t=in:d=0.06,afade=t=out:st=2.94:d=0.06,adelay=7000|7000[a2];\
[3:a]afade=t=in:d=0.06,afade=t=out:st=1.14:d=0.06,adelay=11800|11800[a3];\
[4:a]afade=t=in:d=0.06,afade=t=out:st=1.94:d=0.06,adelay=14600|14600[a4];\
[a0][a1][a2][a3][a4][5:a]amix=inputs=6:normalize=0:duration=longest[m];\
[m]aformat=sample_fmts=s16:channel_layouts=mono:sample_rates=16000,atrim=0:17[out]" \
  -map "[out]" -ac 1 -ar 16000 -c:a flac -compression_level 12 labelled-speech.flac

echo "wrote labelled-speech.flac"
