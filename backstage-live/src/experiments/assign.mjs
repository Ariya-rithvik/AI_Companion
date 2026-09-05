/**
 * Randomised assignment of REAL meetings to arms. Runs before a meeting starts.
 *
 * BUILD:
 *  - export assign(meetingId, experimentId) -> { arm, decided_before_meeting: true }
 *      * deterministic hash of (meetingId + experimentId + salt) so a retry gives
 *        the same arm and cannot be re-rolled
 *      * write ObsAssignment immediately; the timestamp is the evidence that the
 *        arm was chosen before the meeting rather than after
 *      * refuse if the meeting has already started - log it, do not silently assign
 *  - export armFor(meetingId) -> the arm the host's UI should apply
 *  - block randomisation: if you run few meetings, assign in blocks of 4 (2 control,
 *    2 treatment shuffled) so the arms stay balanced at small N
 *  - stratify on anything that dominates the outcome and that you know in advance -
 *    registrant count, meeting type, host. Unstratified randomisation at n=30 can
 *    easily hand one arm all the big meetings
 *
 * THE HOST-SIDE HALF:
 *  armFor() has to actually change what happens in the meeting. Surface it in the
 *  host's console as a pre-meeting instruction ("this meeting: demo first, pricing
 *  after Q&A"). If the host ignores it, the arm is contaminated - record compliance
 *  as a field and report it. An experiment where nobody followed the instructions
 *  is not a null result, it is no result.
 */
