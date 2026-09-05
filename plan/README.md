# plan/ — specification only. There is no working code in here.

**Every `.mjs` file in `src/` is a comment block describing what to build. None of them execute.**
Saying that plainly at the top, because a directory of 27 empty modules can otherwise read as
padding, and it is the opposite — it is the design for the production version, written before
the code so the code has something to be checked against.

The working submission is `../razorpay/`. Run it with `npm run recover`.

## What this describes

The path from the benchmark to a live deployment: tapping a real meeting server for events,
consent, transcript, an LLM observer whose every claim cites the rows it rests on, randomised
experiment assignment, and memory that carries patterns between sessions.

`PLAN.md` has the phase order and an acceptance test for each phase. The comments in each stub
are the specification for that file.

## Why it is kept here rather than deleted

Two of its ideas are already implemented in the submission and were designed here first:

- the **cited-claim validator** — now `../razorpay/explain.mjs`
- the **pre-conclude invariant** that refuses to finalise money without visible arithmetic —
  now `../razorpay/pacer.mjs`

The rest is honest future work, not a claim about what exists.
