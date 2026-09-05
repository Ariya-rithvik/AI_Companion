/**
 * Turns a finished experiment into a stored skill. The ONLY way a skill is created.
 *
 * BUILD:
 *  - export promote(experimentId):
 *      1. load analyze(experimentId)
 *      2. refuse if effect is null (underpowered)
 *      3. refuse if ci90 spans zero
 *      4. refuse if compliance_rate < 0.8 - the change was not really applied
 *      5. otherwise write ObsSkill with evidence pointing at the experiment id
 *  - every refusal returns a reason string that the console displays verbatim.
 *    The refusals are the most credible part of the demo: show one live
 *  - export demote(skillId, reason) for when a re-test fails; keep the history
 */
