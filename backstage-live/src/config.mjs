/**
 * Central config. Every other file imports from here — no process.env reads
 * scattered through the codebase.
 *
 * BUILD:
 *  - load dotenv
 *  - export a frozen object: mongoUri, anthropicKey, models{observer,analyst,proposer},
 *    stt{provider,key}, ingestSecret, jwtSecret, port
 *  - throw at import time if MONGODB_URI or ANTHROPIC_API_KEY is missing, with a
 *    message naming the variable. Failing loudly at boot beats failing at 2am
 *    inside a live meeting.
 *  - export IS_DEV = process.env.NODE_ENV !== 'production'
 */
