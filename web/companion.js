/**
 * AI Companion — a floating, host-only overlay.
 *
 * DESIGN NOTE, because this is the part everyone gets wrong.
 * Film HUDs (Iron Man, Oblivion, Prometheus) are built to be read by a camera in
 * two seconds. They look busy deliberately: density reads as "powerful" on
 * screen. Copy that literally into a product and you get something nobody can
 * operate. The critique of JARVIS that actually matters is that a genuinely
 * intelligent assistant should be nearly invisible and ask for almost no
 * interaction.
 *
 * So this borrows the LANGUAGE and keeps real hierarchy:
 *   - Oblivion's hairlines, corner brackets and strict grid
 *   - JARVIS's radial gauges and boot sequence
 *   - monospace telemetry, a scan sweep when a frame is captured
 *   - and, crucially, it stays collapsed to a single orb until it has something
 *     worth saying. Quiet is the feature.
 *
 * Mounted in a shadow root so no host stylesheet can break it and it cannot
 * leak styles into the host. Works on the console and inside the meeting room.
 * Zero dependencies.
 */

const CSS = `
:host{all:initial}
*{box-sizing:border-box;margin:0;padding:0}
.wrap{
  position:fixed;z-index:2147483000;
  font-family:"IBM Plex Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  color:#dcefee;-webkit-font-smoothing:antialiased;
}
.mono{font-family:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}

/* ── the orb: what you see 95% of the time ───────────────────────────── */
.orb{
  width:58px;height:58px;border-radius:50%;cursor:grab;position:relative;
  background:radial-gradient(circle at 34% 30%,rgba(45,212,191,.22),rgba(6,20,24,.94) 66%);
  border:1px solid rgba(45,212,191,.38);
  box-shadow:0 8px 32px rgba(0,0,0,.55),0 0 0 1px rgba(0,0,0,.35),
             inset 0 0 22px rgba(45,212,191,.14);
  backdrop-filter:blur(10px);display:grid;place-items:center;transition:transform .18s;
}
.orb:hover{transform:scale(1.06)}
.orb:active{cursor:grabbing}
.orb svg{position:absolute;inset:0;width:100%;height:100%}
.ring-track{fill:none;stroke:rgba(45,212,191,.15);stroke-width:1.5}
.ring-arc{fill:none;stroke:#2dd4bf;stroke-width:1.5;stroke-linecap:round;
  transform-origin:50% 50%;animation:spin 3.4s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.core{width:10px;height:10px;border-radius:50%;background:#2dd4bf;
  box-shadow:0 0 12px #2dd4bf,0 0 26px rgba(45,212,191,.5);animation:breathe 3s ease-in-out infinite}
@keyframes breathe{0%,100%{opacity:.55;transform:scale(.82)}50%{opacity:1;transform:scale(1.14)}}
.orb.alert{border-color:rgba(255,140,120,.6)}
.orb.alert .core{background:#ff8c78;box-shadow:0 0 14px #ff8c78,0 0 30px rgba(255,140,120,.55)}
.orb.alert .ring-arc{stroke:#ff8c78}
.badge{
  position:absolute;top:-3px;right:-3px;min-width:19px;height:19px;border-radius:10px;
  background:#ff5a45;color:#fff;font-size:10.5px;font-weight:700;display:grid;place-items:center;
  padding:0 5px;border:2px solid #061418;
}
.orb .hint{
  position:absolute;right:68px;top:50%;transform:translateY(-50%);white-space:nowrap;
  background:rgba(6,20,24,.94);border:1px solid rgba(45,212,191,.3);border-radius:6px;
  padding:5px 10px;font-size:11px;opacity:0;pointer-events:none;transition:opacity .2s;
}
.orb:hover .hint{opacity:1}

/* ── the panel ────────────────────────────────────────────────────────── */
.panel{
  width:376px;max-height:min(76vh,680px);display:flex;flex-direction:column;
  background:linear-gradient(170deg,rgba(9,26,31,.96),rgba(5,15,19,.97));
  border:1px solid rgba(45,212,191,.24);border-radius:12px;overflow:hidden;
  box-shadow:0 24px 70px rgba(0,0,0,.62),0 0 0 1px rgba(0,0,0,.4),
             inset 0 1px 0 rgba(255,255,255,.05);
  backdrop-filter:blur(18px) saturate(1.2);
}
/* Oblivion-style corner brackets: hairlines, not boxes */
.panel::before,.panel::after{
  content:"";position:absolute;width:16px;height:16px;pointer-events:none;
  border-color:rgba(45,212,191,.55);
}
.panel::before{top:8px;left:8px;border-top:1px solid;border-left:1px solid}
.panel::after{bottom:8px;right:8px;border-bottom:1px solid;border-right:1px solid}

.hdr{display:flex;align-items:center;gap:9px;padding:11px 13px;cursor:grab;
  border-bottom:1px solid rgba(45,212,191,.14);background:rgba(45,212,191,.045)}
.hdr:active{cursor:grabbing}
.dot{width:7px;height:7px;border-radius:50%;background:#2dd4bf;
  box-shadow:0 0 9px #2dd4bf;animation:breathe 3s ease-in-out infinite;flex:none}
.ttl{font-size:11px;font-weight:700;letter-spacing:1.3px;text-transform:uppercase}
.state{font-size:9.5px;letter-spacing:.7px;color:#6fb3ab;text-transform:uppercase}
.spacer{flex:1}
.iconbtn{width:22px;height:22px;border:0;border-radius:5px;background:transparent;color:#6fb3ab;
  cursor:pointer;display:grid;place-items:center;font-size:14px;line-height:1}
.iconbtn:hover{background:rgba(45,212,191,.14);color:#dcefee}

.scan{position:absolute;left:0;right:0;height:64px;pointer-events:none;opacity:0;z-index:3;
  background:linear-gradient(180deg,transparent,rgba(45,212,191,.16),transparent)}
.scan.go{animation:sweep 1s ease-in-out}
@keyframes sweep{0%{top:0;opacity:1}100%{top:100%;opacity:0}}

.body{flex:1;overflow-y:auto;padding:13px;display:flex;flex-direction:column;gap:13px}
.body::-webkit-scrollbar{width:6px}
.body::-webkit-scrollbar-thumb{background:rgba(45,212,191,.25);border-radius:6px}

/* ── radial gauges ─────────────────────────────────────────────────────── */
.gauges{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.g{position:relative;aspect-ratio:1;display:grid;place-items:center}
.g svg{position:absolute;inset:0;width:100%;height:100%;transform:rotate(-90deg)}
.g .gt{fill:none;stroke:rgba(45,212,191,.12);stroke-width:3}
.g .gv{fill:none;stroke:#2dd4bf;stroke-width:3;stroke-linecap:round;transition:stroke-dashoffset .55s ease}
.g.warn .gv{stroke:#f0b45f}
.g.crit .gv{stroke:#ff8c78}
.g .num{font-size:17px;font-weight:600;letter-spacing:-.5px;font-variant-numeric:tabular-nums;z-index:1}
.g .lab{position:absolute;bottom:-1px;font-size:8.5px;letter-spacing:.7px;color:#5e9a93;
  text-transform:uppercase;z-index:1}

/* ── sections ──────────────────────────────────────────────────────────── */
.sec{display:flex;flex-direction:column;gap:7px}
.sech{display:flex;align-items:center;gap:7px;font-size:9.5px;letter-spacing:1.1px;
  text-transform:uppercase;color:#5e9a93;font-weight:700}
.sech .ln{flex:1;height:1px;background:linear-gradient(90deg,rgba(45,212,191,.25),transparent)}
.cnt{background:rgba(45,212,191,.14);border-radius:20px;padding:1px 6px;font-size:9px}

.say{
  border:1px solid rgba(45,212,191,.3);border-left:2px solid #2dd4bf;border-radius:7px;
  padding:10px 12px;font-size:12px;line-height:1.5;background:rgba(45,212,191,.07);
  animation:slidein .35s ease;
}
.say.crit{border-color:rgba(255,140,120,.4);border-left-color:#ff8c78;background:rgba(255,140,120,.08)}
.say .meta{display:flex;gap:8px;font-size:9px;letter-spacing:.5px;color:#6fb3ab;margin-bottom:5px}
.say .why{margin-top:6px;font-size:10px;color:#5e9a93}
@keyframes slidein{from{opacity:0;transform:translateX(10px)}}

.rows{display:flex;flex-direction:column;gap:4px;max-height:132px;overflow-y:auto}
.row{display:flex;align-items:center;gap:8px;font-size:11px;padding:5px 8px;border-radius:5px;
  background:rgba(255,255,255,.028)}
.row .pip{width:5px;height:5px;border-radius:50%;flex:none;background:#ff8c78}
.row .who{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#a9cdc9}
.row .val{font-size:10px;color:#ff8c78}

.tele{border-top:1px solid rgba(45,212,191,.13);padding-top:9px;font-size:9.5px;line-height:1.75;
  color:#4d8781;max-height:88px;overflow-y:auto}
.tele div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tele .t{color:#2dd4bf}
.tele .r{color:#ff8c78}

.empty{font-size:11px;color:#4d8781;padding:8px 0}

/* ── boot sequence ─────────────────────────────────────────────────────── */
.boot{padding:20px 18px;display:flex;flex-direction:column;gap:9px;min-height:220px}
.bootline{font-size:11px;letter-spacing:.4px;color:#5e9a93;opacity:0;
  animation:bootin .32s ease forwards}
.bootline b{color:#2dd4bf;font-weight:600}
.bootline.ok::after{content:"  OK";color:#2dd4bf}
@keyframes bootin{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
.bootring{width:76px;height:76px;margin:6px auto 10px;position:relative}
.bootring svg{width:100%;height:100%}
.bootring .b1{fill:none;stroke:rgba(45,212,191,.2);stroke-width:1}
.bootring .b2{fill:none;stroke:#2dd4bf;stroke-width:1.5;stroke-linecap:round;
  stroke-dasharray:40 180;transform-origin:50% 50%;animation:spin 1.15s linear infinite}

@media (prefers-reduced-motion:reduce){
  *{animation-duration:.01ms!important;animation-iteration-count:1!important;
    transition-duration:.01ms!important}
  .core{opacity:1}
}
`;

const BOOT = [
  ['Establishing observation channel', 260],
  ['Loading behavioural memory', 520],
  ['Reconstructing patterns from prior sessions', 820],
  ['Arming timed cues', 1120],
  ['Companion online — visible only to you', 1420],
];

const cClamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const cEsc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export class Companion {
  /**
   * @param {object} o
   * @param {() => object} o.source  called ~2x/sec; returns
   *   { status, vitals:{live,peak,retention,focus,outcomes}, risks:[{who,val}],
   *     cues:[{id,at,say,why,urgent}], events:[{ts,type,actor,detail}] }
   */
  constructor(o = {}) {
    this.opts = { title: 'AI Companion', ...o };
    this.state = 'dormant';
    this.pos = { x: window.innerWidth - 96, y: window.innerHeight - 110 };
    this.seen = new Set();
    this.pending = 0;
    this.host = document.createElement('div');
    this.host.setAttribute('data-companion', '');
    this.root = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    this.wrap = document.createElement('div');
    this.wrap.className = 'wrap';
    this.wrap.setAttribute('role', 'complementary');
    this.wrap.setAttribute('aria-label', 'AI companion, host only');
    this.root.append(style, this.wrap);
    document.body.appendChild(this.host);
    this._place();
    this._onKey = e => { if (e.key === 'Escape' && this.state === 'panel') this.collapse(); };
    window.addEventListener('keydown', this._onKey);
  }

  /* ── lifecycle ──────────────────────────────────────────────────────── */

  boot() {
    if (this.state !== 'dormant') return;
    this.state = 'booting';
    this.pos = { x: 24, y: 96 };   // left side: the console HUD already owns the right
    this._place();
    this.wrap.innerHTML = `<div class="panel"><div class="hdr">
        <span class="dot"></span><span class="ttl">Initialising</span>
        <span class="spacer"></span><span class="state mono">boot</span>
      </div>
      <div class="boot">
        <div class="bootring"><svg viewBox="0 0 76 76">
          <circle class="b1" cx="38" cy="38" r="34"/><circle class="b1" cx="38" cy="38" r="26"/>
          <circle class="b2" cx="38" cy="38" r="34"/>
        </svg></div>
        <div id="bl"></div>
      </div></div>`;
    const bl = this.root.getElementById('bl');
    BOOT.forEach(([text, delay], i) => setTimeout(() => {
      const d = document.createElement('div');
      d.className = 'bootline mono' + (i < BOOT.length - 1 ? ' ok' : '');
      d.innerHTML = i === BOOT.length - 1 ? `<b>${text}</b>` : text;
      bl.appendChild(d);
    }, delay));
    setTimeout(() => { this.state = 'panel'; this.render(); this.start(); }, 1900);
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.render(), 500);
  }

  stop() { clearInterval(this.timer); this.timer = null; }

  expand() { if (this.state === 'orb') { this.state = 'panel'; this.pending = 0; this._reposition(); this.render(); } }
  collapse() { if (this.state === 'panel') { this.state = 'orb'; this._reposition(); this.render(); } }

  destroy() {
    this.stop();
    window.removeEventListener('keydown', this._onKey);
    this.host.remove();
  }

  /** Fire the capture sweep — call it when a frame or moment is recorded. */
  flash() {
    const s = this.root.querySelector('.scan');
    if (!s) return;
    s.classList.remove('go'); void s.offsetWidth; s.classList.add('go');
  }

  /* ── positioning ────────────────────────────────────────────────────── */

  _place() {
    const w = this.state === 'orb' || this.state === 'dormant' ? 58 : 376;
    this.pos.x = cClamp(this.pos.x, 8, Math.max(8, window.innerWidth - w - 8));
    this.pos.y = cClamp(this.pos.y, 8, Math.max(8, window.innerHeight - 90));
    this.wrap.style.left = this.pos.x + 'px';
    this.wrap.style.top = this.pos.y + 'px';
  }

  _reposition() {
    // keep the right edge anchored when swapping between orb and panel, so the
    // thing does not appear to jump across the screen on every toggle
    const wasPanel = this.state === 'orb';
    this.pos.x += wasPanel ? 376 - 58 : 58 - 376;
    this._place();
  }

  _drag(handle) {
    handle.addEventListener('pointerdown', e => {
      if (e.target.closest('.iconbtn')) return;
      const sx = e.clientX - this.pos.x, sy = e.clientY - this.pos.y;
      let moved = false;
      handle.setPointerCapture(e.pointerId);
      const move = ev => {
        if (Math.abs(ev.clientX - sx - this.pos.x) > 2) moved = true;
        this.pos = { x: ev.clientX - sx, y: ev.clientY - sy };
        this._place();
      };
      const up = ev => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        // a click that never moved is a toggle, not a drag
        if (!moved && this.state === 'orb') this.expand();
        ev.stopPropagation();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }

  /* ── render ─────────────────────────────────────────────────────────── */

  render() {
    const d = (this.opts.source ? this.opts.source() : null) ?? {};
    const cues = d.cues ?? [];
    const fresh = cues.filter(c => !this.seen.has(c.id));

    if (this.state === 'orb') {
      this.pending += fresh.length;
      for (const c of fresh) this.seen.add(c.id);
      this._orb(d);
      return;
    }
    if (this.state !== 'panel') return;
    for (const c of cues) this.seen.add(c.id);
    this._panel(d, cues);
  }

  _orb(d) {
    const alert = this.pending > 0 || d.status === 'alert';
    this.wrap.innerHTML = `
      <div class="orb ${alert ? 'alert' : ''}" tabindex="0" role="button"
           aria-label="Open AI companion${this.pending ? `, ${this.pending} new` : ''}">
        <svg viewBox="0 0 58 58">
          <circle class="ring-track" cx="29" cy="29" r="25"/>
          <circle class="ring-arc" cx="29" cy="29" r="25" stroke-dasharray="34 123"/>
        </svg>
        <span class="core"></span>
        ${this.pending ? `<span class="badge">${this.pending > 9 ? '9+' : this.pending}</span>` : ''}
        <span class="hint mono">${this.pending ? this.pending + ' new insight' + (this.pending > 1 ? 's' : '') : 'Companion — watching'}</span>
      </div>`;
    const orb = this.root.querySelector('.orb');
    this._drag(orb);
    orb.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.expand(); } });
    this._place();
  }

  _panel(d, cues) {
    const v = d.vitals ?? {};
    const risks = d.risks ?? [];
    const events = d.events ?? [];
    const status = d.status ?? 'observing';

    this.wrap.innerHTML = `
      <div class="panel">
        <div class="scan"></div>
        <div class="hdr">
          <span class="dot"></span>
          <span class="ttl">${cEsc(this.opts.title)}</span>
          <span class="spacer"></span>
          <span class="state mono">${cEsc(status)}</span>
          <button class="iconbtn" data-act="min" title="Collapse (Esc)" aria-label="Collapse">–</button>
        </div>
        <div class="body">
          <div class="gauges">
            ${gauge('Retention', v.retention, 1, true)}
            ${gauge('Focus', v.focus, 1, true)}
            ${gauge('Live', v.live, Math.max(1, v.peak ?? 1), false)}
          </div>

          <div class="sec">
            <div class="sech">Companion says <span class="ln"></span>
              ${cues.length ? `<span class="cnt mono">${cues.length}</span>` : ''}</div>
            ${cues.length
              ? cues.slice(0, 3).map(c => `
                <div class="say ${c.urgent ? 'crit' : ''}">
                  <div class="meta mono"><span>${cEsc(c.at ?? '')}</span>
                    <span>${c.urgent ? 'ACT NOW' : c.memory ? 'FROM MEMORY' : 'DETECTED LIVE'}</span></div>
                  ${cEsc(c.say)}
                  ${c.why ? `<div class="why mono">${cEsc(c.why)}</div>` : ''}
                </div>`).join('')
              : '<div class="empty">Nothing worth interrupting you for.</div>'}
          </div>

          <div class="sec">
            <div class="sech">At risk <span class="ln"></span>
              <span class="cnt mono">${risks.length}</span></div>
            ${risks.length
              ? `<div class="rows">${risks.slice(0, 5).map(r => `
                  <div class="row"><span class="pip"></span>
                    <span class="who">${cEsc(r.who)}</span>
                    <span class="val mono">${cEsc(r.val)}</span></div>`).join('')}</div>`
              : '<div class="empty">Nobody flagged.</div>'}
          </div>

          <div class="tele mono">
            ${events.slice(0, 12).map(e => `<div>
              <span class="${e.type && /leave|abandon|fail|stall|churn|bounce/.test(e.type) ? 'r' : 't'}">${cEsc(e.ts)}</span>
              ${cEsc(e.type)} ${cEsc(e.actor ?? '')} ${cEsc(e.detail ?? '')}</div>`).join('')
              || '<div>awaiting signal…</div>'}
          </div>
        </div>
      </div>`;

    this._drag(this.root.querySelector('.hdr'));
    this.root.querySelector('[data-act="min"]').onclick = () => this.collapse();
    this._place();
  }
}

/* ── gauge helper ─────────────────────────────────────────────────────── */

function gauge(label, value, max, asPct) {
  const R = 26, C = 2 * Math.PI * R;
  const v = Number.isFinite(value) ? value : 0;
  const frac = cClamp(max ? v / max : 0, 0, 1);
  const cls = frac < 0.34 ? 'crit' : frac < 0.6 ? 'warn' : '';
  const shown = asPct ? Math.round(frac * 100) : Math.round(v);
  return `<div class="g ${cls}">
    <svg viewBox="0 0 64 64">
      <circle class="gt" cx="32" cy="32" r="${R}"/>
      <circle class="gv" cx="32" cy="32" r="${R}"
        stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - frac)).toFixed(1)}"/>
    </svg>
    <span class="num mono">${shown}</span><span class="lab">${label}</span>
  </div>`;
}

/* ── trigger button the host can drop anywhere ────────────────────────── */

/**
 * Renders the "Initialize AI Companion" control and wires it to a Companion.
 * Returns the instance so the host can call flash() on capture events.
 */
export function mountCompanion({ trigger, source, title } = {}) {
  const c = new Companion({ source, title });
  const btn = typeof trigger === 'string' ? document.querySelector(trigger) : trigger;
  if (btn) {
    btn.addEventListener('click', () => {
      if (c.state === 'dormant') { c.boot(); btn.disabled = true; btn.textContent = 'Companion online'; }
    });
  }
  return c;
}
