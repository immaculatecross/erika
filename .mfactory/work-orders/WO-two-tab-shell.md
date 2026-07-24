# WO-two-tab-shell — E-30: Record + Learn, phone-first (opens v0.5)

Target repo: immaculatecross/erika · Branch: `feat/two-tab-shell` · **Review tier: Light**
<!-- Light (not Full): no money/billing, no migration/schema, no data deletion, no secrets, no
     concurrency, not the ingest/analysis correctness path, no external contract. It IS a global
     navigation refactor with a real internal contract (every existing deep link must keep working)
     and a DESIGN.md-binding + D-18-binding surface — so the Light review is thorough against the
     named checklist below, and the dispatcher spot-checks screenshots. A worker may RAISE to Full
     if it uncovers a Full-class surface; never lower. -->

## First action (interrupt-hardening, cloud harness)
Branch `feat/two-tab-shell` off latest `master`; make an **empty commit** and `git push -u origin feat/two-tab-shell` as your very first action.

## Boot
Read `STATE.md` → `FEATURES.md` (the E-30 row) → `DECISIONS.md` → `HANDOVER.md` → `CLAUDE.md` → **`DESIGN.md` (binding — a diff that violates it is wrong even if it works)** → `.mfactory/playbooks/task.md`. This is a UI milestone: DESIGN.md governs every pixel and every motion.

## Objective
Erika becomes a **two-tab, phone-first product**: **Record** (the capture spine + everything about your recorded material) and **Learn** (the daily course). Today's flat sidebar (`components/sidebar.tsx`, `app/template.tsx`) becomes a **two-tab bottom navigation** on phone (the primary form factor), degrading gracefully on wider viewports. Settings leaves the nav and sits behind a **gear**. **Every existing deep link keeps working** via redirects — no 404 for any path a user, a bookmark, or an internal link might hold.

## Information architecture (the spec — FEATURES.md E-30)
- **Record** tab: the capture entry + **Library** grouping — **sessions** (list + `/sessions/[id]` detail with its report/timeline), **archive**, **phrasebook**, **slips** (list + `/slips/[id]` dossier). Record is the home tab.
- **Learn** tab: the daily practice home (today's plan — due cards + lesson + the letter row), **focus**, and **the letter**. (The composer's richer Learn home is E-31; here Learn hosts the existing practice/focus/letter surfaces under the new tab.)
- **Settings**: reachable via a **gear** affordance (e.g. top-corner), not a nav item.
- The existing practice surfaces (`/practice`, `/practice/cards`, `/practice/review`, `/practice/lessons`, `/practice/lessons/[patternKey]`) live under Learn.

## Acceptance criteria
1. **Two-tab shell, phone-first, DESIGN-faithful.** A bottom tab bar (Record · Learn) on phone widths — glass over translucent surface (`backdrop-blur(20px)`), accent-ink active state (black light / white dark), Lucide icons at 1.5px/20px, tab change animated per DESIGN (spring, transform/opacity only, `prefers-reduced-motion` → fade), one-signature-restraint (no third accent hue, no decoration). On wider viewports it degrades gracefully (the sidebar may remain or adapt — your call, but phone is the design target and must look shipped-from-Cupertino). Settings behind a gear. Provide the **route→tab mapping** in the PR.
2. **Every existing deep link keeps working (the contract).** Produce a **redirect/route matrix** covering ALL current routes and prove each resolves (redirect or in-place): `/` , `/practice`, `/practice/cards`, `/practice/review`, `/practice/lessons`, `/practice/lessons/[patternKey]`, `/sessions/[id]`, `/archive`, `/phrasebook`, `/slips`, `/slips/[id]`, `/focus`, `/letter`, `/settings`. No path 404s; no API route (`app/api/**`) changes. A test asserts the redirect map (the key paths resolve to a 200/expected destination). Any internal `<Link>`/`router.push` updated to the new canonical paths (no dangling links).
3. **[RETRO-002 P1] Finish correction-forward on Archive + Letter (D-18 binding).** `/archive` currently headlines the raw error (`app/archive/page.tsx` renders `entry.quote`); flip each row to **headline the correction**, error **tap-to-reveal** (reuse the phrasebook pattern — error absent from the DOM until revealed). The letter (`/letter`) likewise headlines the recast, error subordinate + marked. Do NOT show an erroneous form as a primary/headline stimulus anywhere (D-18). The correction data already exists (`lib/archive.ts` `ArchiveEntry.correction`; the letter's recasts). A test asserts the error is not the headline and (phrasebook-style) not in the initial DOM on Archive.
4. **[RETRO-002 P2] Render the richness-dial notes on the session report (Record surface).** `findings.notes` (migration v16) is parsed (`lib/analysis/findings.ts`) but has **zero readers**. Thread `notes` through the finding view (`lib/analysis-view.ts` `FindingView`) + the analysis route (`app/api/sessions/[id]/analysis/route.ts`) and render an **"Erika also noticed"** line in the expanded finding (pronunciation suspect · a colto register alternative per D-23 · a disfluency note), calm and subordinate to the correction. A test asserts a finding carrying `notes` surfaces them in the report view.
5. **No regression to existing surfaces.** Every screen that worked still works and still matches DESIGN (session map/timeline, slip dossier, focus, phrasebook tap-to-reveal, practice card flip, Compare, spend-in-settings). Drill/FSRS/evidence/export/pin behavior byte-unchanged. **No migration, no schema change, no model calls, no money path touched.**
6. **Gates green:** `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build` all pass. Capture **phone-width screenshots** (light + dark) of: Record tab, Learn tab, the gear→Settings, the corrected Archive (error hidden + revealed), the letter, and an expanded finding showing the notes line — attach/reference them in the PR for the DESIGN spot-check.

## Files and constraints
- Likely touched: `app/template.tsx`, `components/sidebar.tsx` (→ a tab-bar component), new `components/tab-bar.tsx` (or similar; keep any file < 500 lines), `app/layout.tsx`, redirect handling (Next `redirects()` in `next.config.mjs` or route-level), `app/archive/page.tsx`, `app/letter/page.tsx`, `lib/analysis-view.ts`, `app/api/sessions/[id]/analysis/route.ts`, and the relevant page/route files for the tab regrouping. **Do NOT** touch `app/api/**` behavior, migrations, `lib/findings-model.ts` authority, the money path, or `data/`.
- Motion via Motion (framer-motion) only; icons Lucide only; no UI component framework (DESIGN). Conventional Commits; hooks armed (`git config core.hooksPath .mfactory/hooks`); 500-line/file; verify against **disposable** state (throwaway `ERIKA_DATA_DIR`/`ERIKA_DB_PATH`; seed a believable corpus so screens render populated); never commit `data/`/`.env*`. **Do NOT edit STATE.md / FEATURES.md** (the dispatcher owns the ritual at merge).

## Out of scope
- The daily composer / new Learn home richness (E-31), lesson formats (E-32), voice/canon + register dial UI (E-33), the tutor (E-34). E-30 only reshapes navigation and hosts the *existing* surfaces under the two tabs (+ the two folded read-view fixes).
- A "what Erika knows about you" surface (deferred to the operator) — do NOT build it.
- Any migration, schema, or money/spend change.

## Exit report
Append per `.mfactory/playbooks/task.md`: RESULT / PR / Changed / Verified (exact commands + the redirect matrix result + the screenshot list) / Tests added / Risks / Blocker. Verify against disposable state.

---

## Exit report (E-30, feat/two-tab-shell)

RESULT: done
PR: https://github.com/immaculatecross/erika/pull/49

Changed:
- `lib/nav.ts` (new) — pure route→tab matrix + section groupings (Record Library, Learn today/focus/letter).
- `components/tab-bar.tsx` (new) — phone-first bottom glass bar (Record · Learn), accent-ink active, spring indicator, Lucide; reduced-motion drops the shared-layout id to a fade.
- `components/app-shell.tsx` (new) — sticky glass header (wordmark + Settings gear) + section sub-nav; replaces the sidebar in `app/layout.tsx`.
- `components/sidebar.tsx` — deleted (superseded).
- `next.config.mjs` — `redirects()` aliasing `/record`→`/`, `/learn`→`/practice`.
- P1: `components/archive-row.tsx`, `components/letter-recast.tsx` (new) + `app/archive/page.tsx`, `app/letter/page.tsx` — correction headlines, error via `RevealableError` tap-to-reveal (D-18). `e2e/archive.spec.ts` deep-links from the headline control.
- P2: `lib/analysis-view.ts` (`FindingView.notes`), `app/api/sessions/[id]/analysis/route.ts` (threads `notes`), `components/analysis-report.tsx` ("Erika also noticed" aside).

Verified:
- `npm run typecheck` clean · `npm run lint` clean · `npm run test` 579 passed (+22) · `npm run build` compiles · `.mfactory/hooks/run-tripwires.sh --all` exit 0. All files < 500 lines.
- Redirect/route matrix (in PR): all 14 current paths resolve in place; `/record`,`/learn` redirect (307); asserted in `tests/two-tab-shell.test.ts`. No `app/api/**` behavior change.
- Disposable-state walk: seeded a throwaway `ERIKA_DB_PATH`/`ERIKA_DATA_DIR` corpus (3 sessions, findings incl. one carrying notes, 9 cards). Phone-width (390×844) light+dark screenshots captured of Record, Learn, gear→Settings, Archive (error hidden + revealed), the Letter, and an expanded finding with the notes line — DESIGN + D-18 confirmed. Never touched `data/`.

Tests changed/removed: `e2e/archive.spec.ts` — row deep-link now clicks the headline `[data-entry-jump]` (the row is no longer one anchor under correction-forward); no assertion weakened. No tests removed.

Risks: e2e (`test:e2e`, not a CI gate) not executed — Playwright browser CDN is egress-blocked in this sandbox; e2e edits reasoned against the new DOM, unit render tests cover the same contract. No migration/schema/money/model change.

Blocker: none.
