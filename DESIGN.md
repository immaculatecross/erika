# Design constitution

Erika looks and moves like it shipped from Cupertino. These rules are binding for every UI change; a diff that violates them is wrong even if it works.

## Character

Calm, spacious, precise. The interface recedes; your language is the content. Quality shows in restraint: few elements, perfectly finished, beautifully animated.

## Palette

Apple system palette, light and dark, every hue carrying meaning — never decoration.

- **Light:** page `#F5F5F7`, cards `#FFFFFF`, ink `#1D1D1F`, secondary `#6E6E73`, hairline `rgba(0,0,0,0.08)`.
- **Dark:** page `#000000`, cards `#1C1C1E` (elevated `#2C2C2E`), ink `#F5F5F7`, secondary `#98989D`, hairline `rgba(255,255,255,0.12)`.
- **Accent:** black in light mode, white in dark — interactive elements, focus, and the one number that matters on a screen. Green and red are the only color tones, used solely where a state carries meaning (see Semantic). No indigo, no third accent hue; a screen with three accented elements has two too many.
- **Semantic:** red `#FF3B30` (high severity), orange `#FF9500` (medium), green `#34C759` (resolved, mastered). Prefer 10–15% alpha tint fills over saturated blocks.

## Typography

System stack: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif`. Display 34/700 (letter-spacing −0.022em), title 22/600, body 17/400 (line-height 1.47), secondary 15/400, caption 13/500 uppercase (+0.06em). All statistics in tabular numerals.

## Materials and depth

Glass where content scrolls under chrome: `backdrop-blur(20px)` over a translucent surface. Cards radius 18px, controls 12px, action buttons pill. Shadows soft and layered — `0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.06)`; dark mode prefers hairline borders over shadows.

## Motion — the soul; budget quality here

Library: Motion (framer-motion). Transform and opacity only, 60fps, `prefers-reduced-motion` degrades everything to fades.

- **Springs, not durations**, for anything that moves: stiffness ≈260, damping ≈28 — snappy, no wobble.
- Lists stagger in: 30–45ms per item, 8px rise + fade.
- Route changes crossfade with a 12px rise; never a hard cut.
- **One signature moment per surface:** the recording waveform breathing with your voice; the analysis progress orb; a finding expanding in place (layout animation); the practice card's 3D flip; the grade buttons' press-down.
- Every interactive element has hover, active (scale 0.98), and focus (2px accent ring, 2px offset) states.

## Components

Hand-rolled — no UI component framework. Icons: Lucide, 1.5px stroke, 20px default. Primary button: accent fill (black in light, white in dark), inverse-color text, pill. Secondary: neutral tint fill, no border. Tertiary: bare accent text. Mode switches are segmented controls. Empty states: one quiet sentence and one action — no illustrations.

## The daily ritual (Learn) — D-24

The habit layer is geometry and numbers, never a character. Binding for every Learn surface:

- **Goal ring:** one ring, accent ink on a hairline track, closed with the standard spring. No second ring, no color fill.
- **Completion:** one factual sentence, once per day — "Done for today. 9 cards, one lesson." The ring closing is the day's single celebratory beat.
- **Streak:** a number and a word ("Day 14"), caption style; repairs shown factually ("repaired Tue"). No flames, no guilt copy on a broken streak.
- **Knowledge map:** category cells tint toward green only through resolved-slip semantics — green remains mastery, never mere activity.
- **The tutor surface:** a quiet field of small accent-colored dots breathing with the tutor's voice — no avatar, no face, no waveform theatrics; numbers appear as tabular numerals and move gently.
- **Banned, here and everywhere:** confetti, mascots, XP/points/levels, leaderboards, badges, purchasable streak repair, more than one celebratory beat per day.

## Copy

Quiet and exact. Erika speaks like a good editor: never cheerleads, no exclamation marks, sentence case everywhere, always specific — "3 grammar slips in 12 minutes", not "Great job!". Completion may be acknowledged factually, in numbers, once per day — "Day 14. Goal met." is information; acknowledgment is not cheerleading.
