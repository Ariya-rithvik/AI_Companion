# Small tasks for the other account (Opus 4.6 / Sonnet 4.6)

Sized for a model with less context than this session. Each is **one file or one function**,
with an exact acceptance test. None of them touch the same file as another, so run them in
parallel without merge conflicts.

**Paste this preamble into every task:**

> Repo is at `D:\gpt_hackathon`. Before you start run `npm run check` — it must print
> `0 error(s)`. After your change run it again; if it prints any error, you broke a dependency
> and must fix it before finishing. If `node tools/graph.mjs impact <the file you changed>`
> says the file is flattened into `dist/`, also run `npm run build`.
> Never invent a number. If something cannot be measured, return `null` with a reason.

---

## A1 · Recording  `web/meeting-room.html`  — **do this one first**

The meeting room monitors but does **not** record. `MediaRecorder` does not appear anywhere.

> In `web/meeting-room.html`, add local recording with `MediaRecorder`.
> - Record the local stream (and screen share when active) into webm chunks.
> - Add a REC button beside the existing controls in `.topbar`. Red pulsing dot while recording,
>   elapsed recording time next to it.
> - On stop, build a Blob and offer it as a download named `meeting-<meetingId>-<date>.webm`.
> - **Only the host may record.** The button must not render for non-hosts — check the same
>   `isHost` flag the page already uses. Gate it server-side too if a socket event is involved.
> - Show a visible banner to **every** participant while recording is active. Recording people
>   without telling them is unlawful in many places and is not negotiable.
> - Handle: permission denied, no supported mimeType, and stop-while-already-stopped. Each must
>   show a readable message, never a dead button. Copy the error pattern from the `btnCreate`
>   handler in the same file — it has try/catch, a timeout, and a reset on every exit path.
>
> **Acceptance:** host records 10 seconds, stops, gets a playable .webm. A second participant
> sees the recording banner and has no REC button. Deny mic/camera permission → readable error,
> button still usable.

---

## A2 · Robustness pass  `web/meeting-room.html`

I fixed `btnCreate`. The sibling handlers have the same bug shape.

> In `web/meeting-room.html`, apply the pattern already used by the `btnCreate` handler to
> `btnJoin`, `btnLeave`, `btnLeaveTop` and `btnEnd`:
> - wrap in try/catch
> - add an 8-second timeout to every socket round-trip
> - reset the button on **every** exit path, including failure
> - handle `{ok:false}` from the server, not just the happy path — show `data.error`
> - never leave a socket connected after a failure
>
> Do not change any behaviour that already works. This is purely about failure paths.
>
> **Acceptance:** with the server stopped, clicking each button shows a readable red message and
> leaves the button enabled. With the server running, all four still work exactly as before.

---

## A3 · Close the broken route  `server/mcp.mjs` or `web/lingo/`

`GET /lingo/index.html` returns 200 and then throws: it imports `ui.js` and `./tools.js`, and
neither was ever committed. A judge could open it.

> Pick one and do it cleanly:
> **(a)** Stop serving it — make `/lingo/*` return 404 in `server/mcp.mjs`, and move the folder
> to `archive/lingo/`. Note why in a one-line comment.
> **(b)** Finish it — write the missing `web/lingo/ui.js` and `web/lingo/tools.js` so the page
> loads with zero console errors.
>
> (a) is correct unless the lingo demo is part of your submission.
>
> **Acceptance:** either `/lingo/index.html` 404s, or it loads with an empty console. Then
> remove the `web/lingo` entry from the `KNOWN` array in `tools/graph.mjs` and confirm
> `npm run check` still prints `0 error(s)`.

---

## A4 · Kill the duplicate  `web/meeting.js`

`web/meeting.js` is 652 lines that **nothing loads**. The live logic is inlined in
`web/meeting-room.html`. Anyone who edits `meeting.js` will watch their change do nothing.

> Confirm first: `node tools/graph.mjs impact web/meeting.js` — it should show no dependents.
> Then delete `web/meeting.js`, and add a comment at the top of the inline `<script>` in
> `web/meeting-room.html` saying the meeting logic lives there deliberately.
>
> Do **not** try to extract the inline script into a module. That is a bigger change and it
> risks the one part of this project that genuinely works.
>
> **Acceptance:** `/meeting` still creates and joins a room; `npm run check` prints
> `0 error(s)` and no longer warns about `web/meeting.js`.

---

## A5 · Razorpay test-mode wrapper  `razorpay/rzp.mjs`  — **highest value, do it in parallel with A1**

Nothing in this repo calls Razorpay yet. The track requires it.

> Create `razorpay/rzp.mjs`, zero dependencies, Node 20, ESM. Export:
> - `createOrder({ amount, currency = 'INR', receipt, notes })`
> - `createPaymentLink({ amount, customer, notes })`
> - `fetchPayment(id)`
> - `verifyWebhook(rawBody, signature, secret)` — HMAC-SHA256 via `node:crypto`, compared with
>   `crypto.timingSafeEqual`
> - `startWebhookServer({ port, secret, onEvent })` — handles `payment.captured`,
>   `payment.failed`, `payment_link.paid`, normalising each to
>   `{ ts, type, customer_id, amount, method, order_id }`
>
> Auth is HTTP Basic from `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`. Throw a named error at
> import time if either is missing. **Never log a secret, ever.** Retry 5xx with exponential
> backoff, max 3; never retry a 4xx. Amounts are in **paise** — document that on every function
> and convert at the boundary, not in the caller.
>
> **Acceptance:** with test keys in `.env`, a script creates an order, opens the payment link,
> pays with Razorpay's test card, and the webhook server prints one normalised
> `payment.captured`. Also show one deliberately bad signature being rejected.

---

## A6 · Pitch assets  `docs/`

> Read `README.md`, `razorpay/README.md`, `STATUS.md` first. Produce:
> 1. **Architecture diagram** as inline SVG. Start from `node tools/graph.mjs mermaid` for the
>    real module edges. Label clearly which boxes are built and which are planned.
> 2. **5-minute video script** with timestamps. Open on the measured result, not the
>    architecture. The strongest 20 seconds: blanket discounting loses ₹0.65 per rupee,
>    propensity targeting still loses ₹0.59, only incrementality turns it positive at +₹0.38.
> 3. **One-page summary** for the top of the README.
>
> Every figure must be reproducible by a command in this repo. Invent nothing.

---

## Order

Start **A1 and A5 together** — they touch different files and are the two things a judge will
actually look for (recording, and a real Razorpay call). Then A2, then A3/A4 as cleanup, then A6
last so it describes what actually shipped.
