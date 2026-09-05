/**
 * Mongoose connection. Reuses the same MongoDB as your canvas app.
 *
 * BUILD:
 *  - export connect() -> mongoose.connect(config.mongoUri) with:
 *      maxPoolSize 10, serverSelectionTimeoutMS 5000
 *  - log once on 'connected' and on 'error'; do not swallow errors
 *  - export disconnect() for tests
 *  - guard against double-connect (Node --watch re-imports on every save)
 */
