# Spike 4 — Platform & habit: mobile-first era, two-tab IA, calm gamification

Repo audited read-only at `/Users/mattiamauro/Desktop/Murder she wrote/Erika`, 2026-07-23.

## Question

Erika goes mobile-first: web now in a phone viewport, native iOS later as "only a frontend" over the same API. The next era is two primary tabs — **Record** (mic + upload, up to 24 h files) and **Learn** (daily micro-lessons + live AI tutor) — with today's seven surfaces demoted. What API-boundary rules make the backend iOS-ready, how do GB-scale uploads survive flaky networks, what can mobile web honestly promise for recording, what is the two-tab IA, which habit mechanics fit the DESIGN.md identity, and where does hosting go?

## Recommendation

**The API boundary is already right — codify it, don't rebuild it.** Every page in `app/` is a `"use client"` component fetching JSON from `/api/*`; no server component touches SQLite; filesystem paths never leave the server (audio streams via `/api/sessions/[id]/audio` with Range support). Write this down as a convention doc: every new capability ships as a JSON `/api` route first, UI second; one error envelope `{ error: { code, message } }`; a no-op `middleware.ts` auth seam that stamps a single-user principal today; no `/api/v1` prefix yet — additive-only changes, version only when native ships. Retrofit list is short: the non-idempotent `GET /api/letter` viewed-marker (E-18's own recorded limitation) becomes `POST /api/letter/viewed`; ad-hoc `{ error: string }` bodies converge on the envelope opportunistically. Everything else waits.

**Uploads: adopt tus** — `@tus/server` + `@tus/file-store` in one catch-all route (`app/api/uploads/[[...slug]]/route.ts`, `server.handleWeb(req)`), `tus-js-client` in `lib/upload-audio.ts` (skip Uppy's dashboard; Erika hands-rolls UI). Keep the streamed POST as fallback; finalize a completed tus upload into the existing session pipeline.

**Mobile web Record promises**: short foreground takes (~≤15 min, wake-lock held) plus resumable upload of files recorded in Voice Memos or any recorder. Long-form and all-day background capture are explicitly native-only; the UI says so plainly.

**Two-tab IA**: Record and Learn as the only tabs; sessions/archive/phrasebook/slips become a Library reached from Record; letter and focus live inside Learn; settings behind a gear. Deep links stay today's stable paths.

**Calm gamification**: streak with built-in repair, goal ring, one completion moment, knowledge map filling in. Ban confetti, mascots, XP, leaderboards, streak-loss guilt copy. Amend DESIGN.md's "never cheerleads" line to permit factual acknowledgment ("Day 14. Goal met.").

**Hosting**: Litestream over the current better-sqlite3 when the laptop era ends; Turso only if multi-device sync forces it; Postgres not warranted.

## Options

**1. API boundary.** (a) Status quo, tacit — risks a future page reading `lib/db` directly. (b) *Codify current pattern* (chosen): client components + JSON routes, error envelope, auth-seam middleware, no paths in payloads (already true — paths are confined to `lib/audio-storage.ts`/`lib/ffprobe.ts` server-side). (c) Full REST redesign with `/v1` and OpenAPI — premature; ~20 route groups already exist and are iOS-consumable as-is. Retrofit now: letter-viewed GET side effect. Can wait: envelope unification, pagination (already deferred to v0.4), auth, versioning prefix.

**2. Uploads.** (a) *tus* (chosen): open resumable protocol; `@tus/server` v2 runs inside Next.js App Router via `handleWeb` with a documented Next.js recipe ([tus-node-server v2 announcement](https://tus.io/blog/2025/03/25/tus-node-server-v200), [repo](https://github.com/tus/tus-node-server), [Uppy Next.js guide](https://uppy.io/docs/nextjs/)); iOS clients exist (TUSKit), so the native app reuses the endpoint. Integration cost ≈ one route file, a store directory under `data/`, a finalize hook, swapping `lib/upload-audio.ts` internals — days, not weeks. (b) Custom chunked PUT with Content-Range: no dependency, but you re-implement offset tracking, integrity, and expiry that tus specifies. (c) Uppy client + tus: Uppy's Dashboard UI violates the no-component-framework rule; `tus-js-client` alone is lighter.

**3. Mobile web recording.** iOS Safari suspends WebRTC/Web Audio on screen lock or backgrounding ([Apple forums](https://developer.apple.com/forums/thread/774239), [MagicBell PWA guide](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)); long MediaRecorder runs have crashed/reloaded pages on iOS ([Apple forums thread](https://developer.apple.com/forums/thread/694867)). Screen Wake Lock is supported in Safari, with the home-screen-PWA bug fixed in iOS 18.4 ([caniuse](https://caniuse.com/wake-lock), [WebKit bug 254545](https://bugs.webkit.org/show_bug.cgi?id=254545)) — so a *foreground, screen-on* take is defensible. Options: promise everything and disappoint; or *split the promise* (chosen): short takes + upload on web, background capture native-only. Chunk mic takes client-side (timeslice) and hand segments to tus so a crash loses seconds, not the take.

**4. Two-tab IA.** Record owns capture and the raw corpus; Learn owns everything the corpus teaches. Phone-first wireframes (DESIGN.md: caption 13/500 uppercase, one accented number, pill buttons, no third hue):

```
┌──────────────────────────┐   ┌──────────────────────────┐
│ RECORD              ⚙︎   │   │ LEARN               ⚙︎   │
│ Today · 42 min heard     │   │ ◔ Day 14 · goal 2/3      │
│                          │   │                          │
│    (breathing waveform)  │   │ TODAY                    │
│                          │   │  12 cards due    Drill › │
│  [ ● Record ]            │   │  Lesson: articles Start ›│
│  [ Upload a file ]       │   │  Tutor · 4 min    Talk › │
│                          │   │                          │
│ RECENT                   │   │ MAP                      │
│  Tue 22 · 3 h · 9 finds ›│   │  ▦▦▦▢▢  categories       │
│  Mon 21 · 24 m · 2     › │   │                          │
│  Library ›               │   │  This week's letter ›    │
├──────────────────────────┤   ├──────────────────────────┤
│   ● Record      Learn    │   │   Record      ● Learn    │
└──────────────────────────┘   └──────────────────────────┘
```

Secondary surfaces: **Library** (sessions list → session map, archive, phrasebook, slips) under Record; **focus + letter** under Learn; **settings** a gear on both. Deep links: keep today's stable paths (`/sessions/[id]?t=`, `/slips/[id]`, `/letter?week=`) — tabs are entry points, not URL owners; the native app mirrors them as universal links.

**5. Calm gamification.** Evidence: streaks work through loss aversion, and forgiveness *increases* retention rather than diluting it — Duolingo has run 600+ streak experiments; streak-adjacent mechanics moved D7 retention ~14% ([Trophy case study](https://trophy.so/blog/duolingo-gamification-case-study)); Apple's rings show the same loop can turn into guilt without graceful exits ([Trophy on rings](https://trophy.so/blog/the-psychology-of-apple-watchs-close-your-rings)). Quiet precedent: **Gentler Streak** (rest days honored), **Streaks** (pausable), Apple Fitness rings themselves — geometry, not mascots. Proposed set: (1) streak counting *any* completed daily goal, with two automatic repairs/month, earned not bought, applied silently ("Day 14 · repaired Tue"); (2) daily goal ring — one ring, ink-colored, goal user-set (e.g. 10 cards or 1 lesson or 1 recording); (3) one completion moment per day — the ring closes with the existing spring physics, one sentence: "Done for today. 9 cards, one lesson."; (4) knowledge map — the Learn MAP strip as category cells tinting toward green *only* via E-20's resolved-slip semantics (green already means mastery). Banned: confetti, mascots, XP/points/levels, leaderboards, badges, purchasable freezes, loss-guilt notifications, more than one celebratory beat per day. **DESIGN.md amendment needed**: "never cheerleads" stands, but add one sentence — *completion may be acknowledged factually, in numbers, once per day; acknowledgment is not cheerleading.* Also note STATE.md records E-12 as "no gamification"; the letter stays out of the mechanics.

**6. Hosting.** better-sqlite3 keeps working on any single Node host (Fly/Hetzner/VPS); add **Litestream** WAL replication to S3 for durability — zero code change. Turso/libSQL buys managed replication and embedded replicas but replaces the driver; Postgres buys concurrent-writer scale a single-user coach doesn't need ([SQLite-in-production surveys](https://pockit.tools/blog/sqlite-renaissance-turso-d1-libsql-production-guide/), [daily.dev guide](https://daily.dev/blog/sqlite-production-guide-when-how-to-use-beyond-prototyping/)). Direction: single node + Litestream; revisit only when accounts/multi-device sync exist (E-14).

## Risks & unknowns

- `@tus/server` `handleWeb` in App Router: proxy/body-limit interactions on the eventual host unverified; spike on Node 20 locally first. Upload expiry/GC of partial files under `data/` needs a policy (ties to the deferred `data/cache` eviction).
- iOS Safari behavior shifts by point release; the ~15 min take ceiling is a product stance, not a spec number — validate on-device before it's UI copy.
- Live tutor conversation (Learn's third row) is unresearched here — audio duplex on mobile web is its own spike; E-10 "conversation gym" is in the backlog.
- The streak needs a server-side day ledger (new table + migration + `docs/schema.md`), and "day" needs a timezone stance — E-22's UTC-hour caveat says decide *local-day* explicitly.
- No auth today: shipping tus endpoints beyond the laptop without the auth seam is the one hard blocker for hosting.

## Milestone implications

1. **API conventions errand** (docs + middleware no-op + letter-viewed retrofit) — small, do first.
2. **Resumable upload milestone** (tus route, client swap, finalize-to-ingest, partial-file GC).
3. **Two-tab shell milestone** (tab bar, Library regrouping, route redirects; DESIGN.md wireframes above binding).
4. **Learn/daily-goal milestone** (goal ring, streak ledger migration, completion moment, map strip; DESIGN.md copy amendment lands in the same PR).
5. **Tutor conversation** — separate spike, then milestone (supersedes E-10).
6. **Hosting** (Litestream + auth) stays a later milestone (E-14), unblocked by item 1.
