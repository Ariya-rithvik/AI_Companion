<!--
Weekly proposer prompt. Loaded by llm/proposer.mjs .

WRITE IT TO SAY, roughly:

  You receive aggregate statistics and validated findings across many real
  meetings. Propose a small number of specific, testable changes.

  Each proposal names one primary metric, the smallest effect worth detecting,
  and the sessions that motivated it. Propose changes that can actually be
  randomised - "start with the demo" can be assigned per meeting, "hire better
  presenters" cannot.

  Prefer three well-formed proposals to ten vague ones. You are writing a test
  plan someone will spend six weeks of real meetings executing.

RULES TO STATE EXPLICITLY:
  - never claim an effect size, only a direction and a minimum worth detecting
  - flag any proposal whose supporting evidence comes from fewer than five sessions
  - do not propose anything that requires seeing content you were not given
-->
