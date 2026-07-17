# Milestones

In order; each assumes the previous. Statuses: `backlog` → `next` → `building` → `done`. v0.1 is E-1 through E-4 (D-5, the operator's call). One milestone = one mission handed to the dispatcher.

| ID | Status | Milestone | Acceptance test |
|---|---|---|---|
| E-1 | next | Foundation — shell & design system | `npm run dev` serves the app; sidebar nav (Sessions, Practice, Settings) with elegant empty states obeying DESIGN.md; SQLite via a migrations runner; Settings page persists target language, native language, and model choice across reloads; `lint`/`typecheck`/`test`/`build` green locally and as CI checks on PRs; a Playwright screenshot script captures any route to a file. |
| E-2 | backlog | Capture — sessions in | Record from the mic (timer + level indicator) or upload mp3/wav/m4a/webm/ogg; recordings over 30 minutes rejected with a truthful message (duration probed, not guessed); stored as a session and transcoded to analysis-ready mono MP3 via ffmpeg; sessions list + detail page with audio player; delete works. |
| E-3 | backlog | Analysis — the native-audio coach | Analyze on a captured session chunks the audio (~10-min segments), calls `gpt-audio-1.5` (fallback `gpt-audio`), and persists findings (quote, correction, category grammar/vocabulary/phrasing/idiom/pronunciation, explanation, severity, position); progress visible without reload; report UI shows counts by category and expandable findings; failures land in a truthful failed state, never a silent empty report; parsing covered by fixture tests plus one real-API smoke run documented in the PR. |
| E-4 | backlog | Flashcards — drill your own mistakes | Every finding generates a card (front: your phrase in context; back: correction + why), deduplicated; Practice shows the due queue; full-screen practice with flip animation and Again/Hard/Good/Easy grading persisted through SM-2 scheduling; keyboard shortcuts (space to flip, 1–4 to grade); card browser with suspend and delete. |
| E-5 | backlog | Micro-lessons | Recurring error patterns become short grammar lessons with interactive exercises (multiple choice, fill-in, rewrite graded by the model with feedback); completing a lesson updates pattern mastery. |
| E-6 | backlog | Focus map | Weaknesses ranked across sessions with per-category trend over time — the "what should I work on" answer, on one monochrome screen. |
| E-7 | backlog | Hosted + OAuth | The same app deployed multi-user behind OAuth sign-in. |
| E-8 | backlog | Companion ingestion | An authenticated API an always-on recorder or mobile app pushes audio to; sessions appear without the browser. |
