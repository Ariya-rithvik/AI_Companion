/**
 * Entry point. Express + SSE. Start here: npm run dev
 *
 * BUILD:
 *  - connect Mongo, mount routes.mjs, listen on config.port
 *  - GET  /console            the host console (serve src/web/console.html)
 *  - GET  /api/live/:sessionId    SSE stream, host-authorised, see routes.mjs
 *  - POST /ingest             from your canvas Backend (shape B in socket-tap)
 *  - POST /api/beacon         from client-beacon.js
 *  - GET  /api/session/:id    session facts + report
 *  - GET  /healthz            for your existing CI/Terraform
 *  - graceful shutdown: flush the ingest buffer on SIGTERM or you lose the tail of
 *    every meeting on deploy
 *  - do NOT put business logic here. This file is wiring only.
 */
