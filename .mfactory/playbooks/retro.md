# Playbook: retro — the post-version product & technical review

After a block of milestones ships (a version boundary), a fresh look at the **whole product** — not any single diff — that proposes what to improve next. **It ends in adjudicated proposals, never in silently self-dispatched work.** The lens sessions themselves never dispatch anything — a retro whose lenses act on their own findings is the v1 recursion trap (D-01). Adjudication sits with the operator when present, or with the dispatcher under the tight D-12 constraints when the run is unattended — and in either case every verdict, including every rejection, is on the record (the adjudication ledger below).

**When to run.** After a version's milestones are all merged and its run report is filed — including **mid-mission**, at a block boundary inside a long unattended run, when the dispatcher judges a course-correction checkpoint useful (D-12). Not per-PR — that is `review.md`, deliberately blinkered to one diff against one work order and forbidden from scope creep. The retro is the opposite: it is *only* allowed to see the big picture.

## Two lenses, fresh and independent

Run as separate fresh sessions with no access to the builders' reasoning (no-self-grading, D-04/D-07). Split by concern:

- **Product lens — it MUST use the running product.** Install and run the app, **seed realistic data so every surface renders populated** (empty screens teach nothing), drive each route, **screenshot it, and read the screenshots** — judge the actual rendered experience, not the code's intent. Seeding bypasses the pipeline that produced the data, so **also push at least one real input end to end** where feasible: seeded state exercises no ingestion, no parsing, no heuristic (RETRO-001 seeded the DB directly and therefore never ran VAD or the model parser — both of which were broken, D-13). Focus: creative new features, UI/UX improvements, product coherence, and whether the design constitution actually holds across screens each built by a different fresh session.
- **Technical lens — read the code and run it.** Focus: correctness/bugs, architecture, performance, and **consolidating the debt** (the advisories and OPEN lessons the run reports accumulated but no one is tracking), plus test hygiene. Cite `file:line`.

## The consequential-and-grounded bar (this playbook's reason to exist)

An uncalibrated ideation pass floods the operator with trivia — the same way uncalibrated review once serially killed every nontrivial PR (D-07, v1's hardest lesson). The bar is the fix. A proposal earns a place in the ranked list **only** when it is:

1. **Grounded in evidence** — a screen/flow actually observed (cite the route + screenshot) or code actually read (cite `file:line`). No proposing from imagination or generic best-practice.
2. **Consequential** — it states what stays broken, mediocre, or missing if ignored. Apply the **"so what if we don't?"** test: if the honest answer is "nothing / it's fine," it is **not** a ranked proposal. (This is the direct analog of D-07's "if the honest Harm line reads 'it stops safely,' it's advisory.")
3. **Selected, not enumerated** — each lens returns a **hard-capped, ranked shortlist (≤ 7)**, tiered by impact (High / Medium). The cap forces judgment; a long flat list is the failure mode, not the goal.

Cosmetic/style-only observations and restatements of the known backlog go in a single demoted **"minor polish" appendix** — one-liners, never the headline (the ADVISORY analog). They do not count against the cap.

**Ambition is required, not penalized.** Each lens must surface **at least two genuinely novel, thesis-aligned ideas** — concrete enough to become a milestone. The bar filters *triviality and vagueness*, never *boldness*. A big swing passes if it is specific and consequential; a safe tweak fails if it is trivial.

## Output

Each lens returns a ranked shortlist where every item is:

```
Title · Impact (High/Medium) · Effort (S/M/L)
Evidence:      <route + screenshot, or file:line — what you actually saw>
Consequence:   <what stays broken/mediocre/missing if ignored>
Proposal:      <the concrete change>
```

Plus the "minor polish" appendix, and (product lens) the screenshots taken.

## Synthesis → adjudication

The dispatcher (or a synthesis session) merges the lenses into one proposal: de-duplicated, one unified ranking, split into (a) product & UX, (b) software & structure, (c) consolidated debt, (d) a proposed next-version scope. Who adjudicates depends on who is reachable:

- **Operator present:** the operator ratifies what becomes FEATURES/DECISIONS entries; the normal dispatch loop then builds them.
- **Unattended run (D-12):** the dispatcher may adjudicate itself — at a block/version boundary mid-mission, with no operator intervention — under the D-12 constraints: it may **approve** defect fixes, debt consolidation, coherence/UX corrections, and improvements that serve the already-ratified scope (bounded: at most a small handful of work orders per retro, through the full normal loop — same gates, same review bar); it must **defer to the operator** anything that expands product scope or thesis, adds heavy new infrastructure, changes the spend profile, or touches a gate. Rejecting is as legitimate as approving.

**The adjudication ledger is mandatory either way:** every proposal — approved, rejected, or deferred — is recorded with its verdict and one-line reason in the run report, and the full ledger (including everything rejected) appears in the final report to the operator. The dispatcher owns its verdicts; a ledger entry is how it takes responsibility for them. Nothing is ever silently dropped, and nothing outside the approved list is ever dispatched.
