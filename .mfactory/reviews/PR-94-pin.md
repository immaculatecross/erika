# PR #94 pin-fix Full delta review

- PR: https://github.com/immaculatecross/erika/pull/94
- Reviewed SHA: `a9e840aa734344638f21e5f86bb5662577616364`
- Repair base: `bf4eb22be3d426f80082c3268439383727c6cbfd`
- Review tier: Full delta (surgical pin fix only)
- Verdict: **APPROVE**
- Native GitHub review: https://github.com/immaculatecross/erika/pull/94#pullrequestreview-4782005825
- GitHub state: `COMMENTED` because the authenticated account is the PR author; the body explicitly records `APPROVE`.
- Merge recommended: **yes** (once a non-author reviewer identity can land the formal APPROVE, or the operator accepts this comment-review gate as in prior cycles).

## Ratchet result

The standing blocker from `PR-94-final.md` is closed. The pin repair introduces no new equal-or-greater money/schema/spend harm.

## Standing blocker status

### CLOSED — an active preparation can replace the lesson after Start

Start now calls `pinServableItemLesson` (`app/api/session/start/route.ts:22`,
`lib/lessons/lesson-serving.ts:35-64`). When the selected item has no completed
cache body, Start atomically writes authored Italian into the empty claim and
clears `claim_token`. A later owner completion still requires
`body = '' AND claim_token = ?` (`lib/lessons/item-lessons.ts:143-144`), so it
cannot replace the pinned body. Accepted-call spend still finalizes before
`completeItemLesson` (`lib/lessons/item-lessons.ts:459-465`).

Built disposable route sequence (vocabulary-only day):

1. Planner selected `lemma:e#CCONJ`.
2. A live empty claim was inserted and `/api/session` reported `preparing`.
3. Start returned 200 and pinned authored `rule:subject-pronouns` with
   `claim_token = NULL`.
4. First lesson GET returned that deterministic rule body.
5. Late owner UPDATE using both completion predicates changed 0 rows.
6. Second lesson GET was byte-identical to the first; cache `itemId` remained the
   served rule.

Harm closed: silent wrong result / contract violation after Start.

## Verification checklist

1. **Pin freezes served body** — closed as above; focused
   `tests/active-claim-session-stability.test.ts` and
   `tests/item-lessons-schema.test.ts` (“keeps a Start pin…”) pass.
2. **Tests are mutation-sensitive**
   - Removing the pin write (serve authored in memory only) fails the stability
     test at the post-Start non-empty body assertion.
   - Removing only the pin `WHERE body = ''` clause makes Start return 409 for an
     active empty claim (pin cannot freeze; `getItemLesson` stays null).
   - Dropping both `body = ''` and `claim_token = ?` from `completeItemLesson`
     fails the new pin schema test and the former-owner ownership test.
   - Dual defense is intentional: after a correct pin, dropping either complete
     predicate alone is still blocked by the other.
3. **Onboarding and abandoned Start** — both work on the built server:
   - Onboarding → Start 200 → lesson authored `Pronomi soggetto…`, spend 0,
     one nonempty `item_lessons` row.
   - Empty abandoned claim → preparing → Start 200 → authored/pinned,
     `claim_token` cleared, spend 0.
4. **No new money/schema/spend harm** — pin writes only into empty/wrong-version
   rows; late accepted calls still finalize spend; schema.md documents the pin
   contract; disposable probe spend remained 0 (no provider call).
5. **CI** — GitHub `gates` **success** at
   `a9e840aa734344638f21e5f86bb5662577616364`.

## Built-server identity

- Build id: `5MYUYlJbhyNhASJ-VMWUG`
- Random port: `55514`
- Matching `/_next/static/5MYUYlJbhyNhASJ-VMWUG/_buildManifest.js` → 200
- Disposable database: `/tmp/erika-pr94-pin-built-L6yfrq/erika.db`
- Never touched `data/erika.db`; no keys printed.

## Findings

None blocking. None advisory introduced by this pin delta.

I tried hardest to break post-Start body stability under an active claim, the
pin / `body = ''` / token guards, and the onboarding and abandoned Start paths.
