/**
 * Turns stored events into a training file, and back-fills the labels that make
 * it trainable. This is the artefact the whole project exists to produce.
 *
 * LABELS (computed only after ended_at is set — never during the meeting):
 *   label.churn_next   1 if this actor left within the next 5 minutes of this row's t
 *   label.outcome      1 if the actor met the session's success definition
 *
 * The outcome definition is NOT ours to invent. It must come from something real:
 *   - they stayed to the end AND sent >= 1 chat message, or
 *   - they clicked the CTA link (needs a tracked link), or
 *   - your CRM says a deal was created within 14 days (best, needs a CRM join key)
 * Store which definition was used in ObsSession.outcome_definition, so a dataset
 * exported in March is still interpretable in September.
 *
 * BUILD:
 *  - export backfillLabels(sessionId) -> updates rows in bulk; idempotent;
 *    sets ObsSession.labels_backfilled = true
 *  - export exportJSONL({ sessionIds, out }) -> one row per line
 *  - export exportCSV({ sessionIds, out }) -> flattened features + labels
 *  - export stats() -> { sessions, rows, labelled, positives, class_balance }
 *    Print class balance. Churn positives will be a small minority and anyone
 *    training on this needs to know that before they celebrate 94% accuracy.
 */
