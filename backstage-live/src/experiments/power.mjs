/**
 * How many real meetings do you need? Run this BEFORE committing to an experiment.
 * Runnable directly: npm run power
 *
 * BUILD:
 *  - export requiredN({ baseline, mde, sd, alpha = 0.1, power = 0.8 })
 *      two-sample, per arm: n = 2 * (z_{1-alpha/2} + z_{power})^2 * sd^2 / mde^2
 *  - estimate sd from YOUR OWN historical sessions once you have a handful; until
 *    then say so and use a conservative default
 *  - CLI: print a small table of MDE (2, 5, 10 percentage points) against meetings
 *    needed per arm, and the calendar weeks that implies at your real meeting rate
 *
 * SET EXPECTATIONS HONESTLY WITH THIS OUTPUT.
 * Detecting a 5-point retention change usually needs tens of meetings per arm.
 * That is the real cost of a defensible number, and it is worth saying plainly in
 * the demo: this is why most teams never actually know whether their changes work,
 * and it is exactly the gap this project closes.
 */
