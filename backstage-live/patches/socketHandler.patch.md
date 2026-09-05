# Patch: Backend/socket/socketHandler.js

Goal: every meeting event your server already handles also gets forwarded to
Backstage. Additive only.

## 1. At the top

~~~js
import { emitToBackstage } from '../backstage/emit.js'; // small helper you add
~~~

`emitToBackstage(type, { meetingId, actor, payload })` should:
- POST to `${BACKSTAGE_URL}/ingest` with the `X-Backstage-Secret` header
- be **fire-and-forget**: no await in the socket handler, catch and swallow errors,
  1s timeout. Your meeting must never slow down or fail because Backstage is down

## 2. At each existing handler, add one line

Find the places you already handle these and add the emit alongside — do not
restructure the handlers:

| Your existing event | Add |
| --- | --- |
| socket joins a meeting room | `emitToBackstage('participant.join', {...})` |
| `disconnect` | `emitToBackstage('participant.leave', { reason: 'socket_disconnect' })` |
| explicit leave button | `emitToBackstage('participant.leave', { reason: 'left_meeting' })` |
| chat message broadcast | `emitToBackstage('chat.message', { text, len })` |
| canvas draw/stroke | `emitToBackstage('canvas.stroke', {...})` **debounced** |
| screen share start/stop | `emitToBackstage('screenshare.start' / '.stop', {})` |
| mic / camera toggle | `emitToBackstage('mic.toggle' / 'camera.toggle', { on })` |
| new `backstage:signal` from the beacon | forward payload.type through as-is |

## 3. Debounce the canvas

Canvas strokes fire many times per second per user. Batch per actor into one emit
every 5 seconds carrying `{ stroke_count, ms_active }`. Skipping this floods the
dataset and the LLM context with noise that carries almost no information.

## 4. Add the new listener

~~~js
socket.on('backstage:signal', (payload) => {
  // payload.type is one of: tab.hidden | tab.visible | window.blur |
  // window.focus | idle.start | idle.end
  emitToBackstage(payload.type, { meetingId, actor: socket.userId, payload });
});
~~~

## Acceptance

Run a real 2-person meeting. `db.observationevents.countDocuments()` > 0, with a
real `participant.join` and `participant.leave` at true wall-clock times.
