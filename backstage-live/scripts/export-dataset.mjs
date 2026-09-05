/**
 * CLI: npm run export -- --since 30 --out ./data/meetings.jsonl
 *
 * BUILD:
 *  - connect, resolve session ids by date range or explicit --session
 *  - refuse to export a session whose labels_backfilled is false; tell the user to
 *    run npm run backfill first. Exporting unlabelled rows produces a file that
 *    looks fine and trains nothing
 *  - call store/dataset.exportJSONL, then print stats(): sessions, rows, labelled,
 *    positives, class balance
 *  - write a sidecar .meta.json next to the export: date range, session ids, the
 *    outcome definition used, git sha. In six months this is the only thing that
 *    will let anyone interpret the file
 */
