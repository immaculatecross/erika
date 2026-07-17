# Erika

Master the language you already speak. Local-first web app: give it up to thirty minutes of your real speech; a native-audio model inventories your mistakes; Erika turns them into flashcards, micro-lessons, and a focus map. The curriculum is you.

- **PRODUCT.md** — what this is and why.
- **DESIGN.md** — the binding design constitution.
- **FEATURES.md** — milestones and what's next.
- **DECISIONS.md** — settled calls.

## Setup

Prerequisites: Node 20+, `ffmpeg`/`ffprobe` on PATH.

```sh
cp .env.example .env.local        # add your OpenAI API key (gpt-audio access)
git config core.hooksPath .mfactory/hooks
```

App commands (`npm run dev` etc.) land with milestone E-1.
