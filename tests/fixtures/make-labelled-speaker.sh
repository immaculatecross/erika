#!/bin/bash
# Regenerate tests/fixtures/labelled-speaker.flac + .json — the D-13 calibration
# sample for E-36 speaker attribution (mirrors make-labelled-speech.sh's discipline).
#
# A single synthetic voice cannot falsify a speaker THRESHOLD, and a trivially
# separable pair (e.g. a 200 Hz tone vs a 2 kHz tone) would let ANY τ score
# perfectly — proving nothing (the D-13 point about tone fixtures). So this builds
# TWO synthetic voices that are distinct in FORMANT structure (the spectral envelope
# a mel/x-vector feature actually keys on) yet carry realistic WITHIN-speaker spread
# and BETWEEN-speaker overlap:
#
#   * "user"  — a voiced complex with energy in the LOW-MID harmonics (a low, dark
#     timbre). f0 jitters 115/125/135 Hz across utterances; three vowel-like weight
#     sets vary the envelope within the speaker.
#   * "other" — a voiced complex with energy in the HIGHER harmonics (a brighter
#     timbre). f0 jitters 150/165/180 Hz; its own three vowel sets.
#
# Both sit over a shared pink-noise room floor and are amplitude-modulated at 4.5 Hz
# (syllabic), so neither loudness nor a single band trivially separates them. The
# first four "user" utterances are the ENROLLMENT reference (enroll=true); the rest
# are the held-out calibration set. Deterministic: fixed f0s, offsets, noise seed.
#
# Labels (per utterance span, one window each) live in labelled-speaker.json and are
# asserted by tests/speaker-calibration.test.ts: the recall-first τ reaches user
# recall ≥ 0.99 while excluding the other speaker, and a naive baseline fails.
set -euo pipefail
cd "$(dirname "$0")"

DUR=2.4          # utterance seconds (≤ the 4 s attribution window ⇒ one window each)
STRIDE=3000      # ms between utterance starts (0.6 s gap)
SR=16000

# Two FORMANT templates over a shared f0 (bash arithmetic for the harmonic
# multiples): "low" concentrates energy in h1..h4, "high" in h2..h12. A voice is not
# a pure template — each utterance BLENDS them by a "user-ness" weight w in [0,1]
# (w·low + (1-w)·high). w is the one knob that morphs the spectral envelope, so it
# controls how close a window lands to the enrolled centroid — which is how the
# fixture carries realistic WITHIN-speaker spread and BETWEEN-speaker OVERLAP rather
# than a trivially separable gap (the D-13 point). A small f0 jitter adds scatter.
low_harmonics() {
  local f=$1
  echo "(sin(2*PI*$f*t)+0.75*sin(2*PI*$((f*2))*t)+0.5*sin(2*PI*$((f*3))*t)+0.28*sin(2*PI*$((f*4))*t))"
}
high_harmonics() {
  local f=$1
  echo "(0.6*sin(2*PI*$((f*10))*t)+0.72*sin(2*PI*$((f*14))*t)+0.6*sin(2*PI*$((f*18))*t)+0.4*sin(2*PI*$((f*22))*t))"
}

# One aevalsrc utterance string. $1 w(user-ness 0..1)  $2 f0  $3 amp
utterance() {
  local w=$1 f0=$2 amp=$3 wl wh
  wl=$w
  wh=$(awk "BEGIN{printf \"%.3f\", 1-$w}")
  echo "aevalsrc='$amp*(0.6+0.4*sin(2*PI*4.5*t))*($wl*$(low_harmonics "$f0")+$wh*$(high_harmonics "$f0"))':d=$DUR:s=$SR"
}

# The timeline: voice, user-ness w, f0, amp per utterance. The first four USER
# utterances (w≈0.9) are the enrollment reference; then a held-out set whose USER
# windows span w 0.60→0.90 (a low outlier at 0.60 that a naive midpoint τ will wrongly
# drop) and whose OTHER windows span w 0.10→0.42 (a high outlier at 0.42 that the
# recall-first τ will admit as a false-include — the cost D-22 accepts).
VOICES=(user  user  user  user  user  other user  other other user  other user  other other user  other)
WS=(    0.97  0.99  0.98  0.96  0.56  0.52  0.80  0.60  0.84  0.90  0.46  0.95  0.76  0.56  0.78  0.66)
F0S=(   120   128   124   132   122   150   126   148   152   130   150   124   146   150   128   152)
AMPS=(  0.058 0.052 0.056 0.054 0.050 0.055 0.054 0.058 0.050 0.056 0.052 0.058 0.056 0.050 0.058 0.054)
ENROLL=(1     1     1     1     0     0     0     0     0     0     0     0     0     0     0     0)

n=${#VOICES[@]}
total_ms=$(( (n - 1) * STRIDE + ${DUR%.*} * 1000 + 200 ))
total_s=$(awk "BEGIN{printf \"%.3f\", $total_ms/1000}")

inputs=()
filters=()
labels=()
json_windows=()
for i in $(seq 0 $((n - 1))); do
  start=$(( i * STRIDE ))
  end=$(( start + ${DUR%.*} * 1000 + 200 ))   # steady span (stops before the fade-out tail)
  inputs+=(-f lavfi -i "$(utterance "${WS[$i]}" "${F0S[$i]}" "${AMPS[$i]}")")
  st=$(awk "BEGIN{printf \"%.2f\", $DUR-0.06}")
  filters+=("[$i:a]afade=t=in:d=0.06,afade=t=out:st=$st:d=0.06,adelay=$start|$start[a$i]")
  labels+=("[a$i]")
  enroll_bool=false; [ "${ENROLL[$i]}" = 1 ] && enroll_bool=true
  json_windows+=("    {\"startMs\": $start, \"endMs\": $end, \"speaker\": \"${VOICES[$i]}\", \"enroll\": $enroll_bool}")
done

noise_idx=$n
inputs+=(-f lavfi -i "anoisesrc=c=pink:a=0.0030:d=$total_s:r=$SR:seed=42")

mix="$(IFS=';'; echo "${filters[*]}");$(IFS=''; echo "${labels[*]}")[$noise_idx:a]amix=inputs=$((n + 1)):normalize=0:duration=longest[m];[m]aformat=sample_fmts=s16:channel_layouts=mono:sample_rates=$SR,atrim=0:$total_s[out]"

ffmpeg -y -hide_banner -loglevel error "${inputs[@]}" \
  -filter_complex "$mix" -map "[out]" -ac 1 -ar $SR -c:a flac -compression_level 12 labelled-speaker.flac

{
  echo "{"
  echo "  \"totalMs\": $total_ms,"
  echo "  \"sampleRateHz\": $SR,"
  echo "  \"windows\": ["
  (IFS=$',\n'; echo "${json_windows[*]}")
  echo "  ]"
  echo "}"
} > labelled-speaker.json

echo "wrote labelled-speaker.flac + labelled-speaker.json ($n windows, ${total_ms}ms)"
