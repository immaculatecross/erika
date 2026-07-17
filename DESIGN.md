# Design constitution

Erika is monochrome, quiet, and precise — Apple-grade minimalism. These rules are binding for every UI change; a diff that violates them is wrong even if it works.

## Palette (strict)

Grayscale only. Light mode: background `#FFFFFF`, raised surface `#FAFAFA`, hairline `#E5E5E5`, ink `#0A0A0A`, secondary text `#6F6F6F`, faint `#A3A3A3`. Dark mode inverts the ramp (background `#0A0A0A`, ink `#FAFAFA`, hairline `#262626`, secondary `#A3A3A3`).

No color anywhere. State, severity, success, and failure are expressed through weight, size, motion, and words — never hue.

## Typography

System stack: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif`. Scale: 34/semibold page titles (letter-spacing −0.02em), 22/semibold section heads, 17/regular body, 15/regular secondary, 13/medium uppercase labels (letter-spacing +0.06em). All statistics use tabular numerals.

## Space and surfaces

4px grid. Page gutters 32px, card padding 24px, section gaps 64px. Content column max-width ~720px for reading surfaces. Cards are white on white, separated by 1px hairlines, radius 16px; controls radius 10px. Shadows at most `0 1px 2px rgba(0,0,0,0.04)` — the design is flat.

## Motion

150–250ms, ease-out, opacity plus a translate of at most 8px. Each surface may have one deliberate signature move (the card flip in practice, the reveal of a finding). Nothing bounces, nothing spins.

## Components

Primary button: ink fill, background-color text, pill radius. Secondary: hairline ghost. Mode switches are segmented controls. Focus ring: 2px ink, 2px offset. Empty states: one quiet sentence and one action — no illustrations, no emoji.

## Copy

Quiet and exact. Erika speaks like a good editor: never cheerleads, no exclamation marks, always specific ("3 grammar slips in 12 minutes", not "Great job!").
