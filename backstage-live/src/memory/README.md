# Memory

The difference between a dashboard and a companion.

The prototype's `engine/memory.mjs` already implements this loop end to end against simulated
runs, and it works: after three runs it produces a pattern like *"Pricing & packaging is where
you lose the most people — 39 on average, around 29.5min"* and fires a cue at **26:15**, about
three minutes before the room reaches it.

Port that file. Change three things and nothing else:

1. **Storage** — Mongo instead of localStorage (`store.mjs`)
2. **Evidence** — real `cited_seqs` into `ObservationEvent`, so every claim is checkable
3. **An LLM pass** — additive only, on top of the deterministic detectors (`consolidate.mjs`)

Keep the honesty rules exactly as they are. They are the reason the output is trustworthy:

- nothing asserted below 3 episodes
- every pattern shows its denominator (`3/4 runs`)
- observational patterns are labelled and never called causal
- patterns that stop reproducing decay and stop firing

## The demo this unlocks

> "It sat in your last four meetings. Before this one starts it tells you the three things that
> went wrong every time. Twenty-six minutes in, while you are still taking questions, it tells
> you the pricing section is coming and that it has cost you forty people on average."

That is a companion. Everything before it was a dashboard.
