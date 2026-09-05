/**
 * OPTIONAL. Only build this if you need to observe meetings on real Zoom rather
 * than your own platform. Your own platform is strictly better for this project —
 * you get canvas strokes, per-participant permissions and tab visibility, none of
 * which Zoom will ever give you. Treat this as a "works with Zoom too" checkbox.
 *
 * BUILD:
 *  - Zoom Webhooks give you: meeting.started/ended, participant_joined/left,
 *    recording.completed. Verify the x-zm-signature header — unverified webhook
 *    endpoints are a standing invitation to forged events.
 *  - map each to the same row types as socket-tap so nothing downstream changes
 *  - Zoom gives you NO attention signal and NO chat unless you run a meeting bot
 *    via the RTMS / Meeting SDK. Note that limitation in the console rather than
 *    quietly showing thinner data that looks the same.
 */
