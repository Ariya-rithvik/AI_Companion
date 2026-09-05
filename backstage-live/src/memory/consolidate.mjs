/**
 * Turn real episodes into patterns. Two passes, in this order — the order is
 * what keeps the LLM honest.
 *
 * PASS 1 — DETERMINISTIC (always runs, needs no model)
 *   Port the three detectors from engine/memory.mjs:
 *     loss_hotspot        the stage that tops the departure list in >=50% of episodes
 *     recurring_question  the same question raised in >=60% of episodes
 *     observed_effect     episodes with a change armed vs without (tag observational)
 *   These are arithmetic. They cannot hallucinate, and they run for free.
 *
 * PASS 2 — LLM (only when configured; strictly additive)
 *   Give the model: the deterministic patterns, the episode summaries, and the
 *   unanswered-question lists. Ask for patterns the arithmetic CANNOT see —
 *   causal stories, phrasing that keeps failing, an objection that always
 *   precedes a drop.
 *
 *   Every LLM pattern must carry cited_seqs. Validate them against
 *   ObservationEvent before writing, exactly as llm/analyst.mjs does, and DROP
 *   any pattern whose citations do not resolve. Store source:'llm' so the
 *   console can show which claims came from a model and which from counting.
 *
 * BUILD:
 *  - export consolidate({ surface, hostId })
 *  - run it on session close, and nightly across all surfaces
 *  - reinforce/decay: a pattern found again increments confirmed; one that was
 *    expected and did not reappear increments contradicted. Drop below 0.15 and
 *    it is forgotten. A memory that only accumulates becomes superstition.
 *  - NEVER let the LLM edit a deterministic pattern's numbers. It may add
 *    patterns and rephrase text; the arithmetic is not up for negotiation.
 */
