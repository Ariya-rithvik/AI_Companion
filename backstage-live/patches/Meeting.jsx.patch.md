# Patch: Frontend/pages/Meeting.jsx

Two additions: the consent banner, and the beacon.

## 1. Consent banner — build this FIRST

Before any transcript or recording row is written, every participant must have
consented. Recording and transcribing people without consent is unlawful in many
jurisdictions, and it is the fastest way to kill this project inside a company.

~~~jsx
{!consentGiven && (
  <ConsentBanner
    onAccept={() => { setConsentGiven(true); socket.emit('backstage:consent', { accepted: true }); }}
    onDecline={() => { socket.emit('backstage:consent', { accepted: false }); }}
  />
)}
~~~

The banner must state plainly, in the participant's words:
- what is recorded: joins, leaves, chat, canvas activity, and whether this tab is
  in front of you
- what is **not**: your screen, your keystrokes, your other tabs, your camera feed
- who sees it: the meeting host only
- that declining leaves the meeting fully usable — and make that true. A consent
  prompt with no real second option is not consent

Persist per participant in `ObsSession.participants[].consent`. On decline, still
record presence (join/leave) if your terms cover it, but write **no** transcript
and no beacon rows for that person.

## 2. Mount the beacon

~~~jsx
useEffect(() => {
  if (!consentGiven || !socket) return;
  const stop = startBeacon({ socket, meetingId, userId });
  return stop;   // required: React StrictMode mounts twice in dev
}, [consentGiven, socket, meetingId, userId]);
~~~

## 3. Host-only console link

Show a "Companion" button **only when `user.id === meeting.hostId`**, opening
`/console?meeting=<id>` in a new tab. Gate it in the backend too — a hidden button
is not access control.

## Acceptance

Join as host in one browser and as a participant in another. The participant sees
the consent banner and no companion UI whatsoever. The host sees the button. Switch
the participant to another tab for ten seconds: a `tab.hidden` and a `tab.visible`
row appear in Mongo.
