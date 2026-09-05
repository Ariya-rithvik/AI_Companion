/**
 * Read/arm the skill library, and surface armed skills to hosts before meetings.
 *
 * BUILD:
 *  - export list({ armedOnly }) / arm(skillId, bool)
 *  - export briefingFor(meetingId) -> the plain-language pre-meeting checklist the
 *    host sees: which armed skills apply, and if this meeting is in an experiment,
 *    which arm it is in and what to do differently
 *  - export retest(skillId) -> registers a fresh experiment rather than re-running
 *    old numbers. A skill measured six months ago on a different audience is a
 *    hypothesis again, not evidence
 *  - track times_applied by counting real meetings whose arm included the skill,
 *    not by incrementing a counter when someone clicks a toggle
 */
