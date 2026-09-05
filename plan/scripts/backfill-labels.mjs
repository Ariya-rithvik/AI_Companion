/**
 * CLI: npm run backfill -- --session <id>   (or --all)
 *
 * BUILD:
 *  - for each ended session, call store/dataset.backfillLabels
 *  - idempotent: safe to re-run over already-labelled sessions
 *  - refuse sessions with no ended_at - a meeting still running has no labels yet,
 *    by definition
 *  - print per session: rows updated, churn positives, outcome positives
 */
