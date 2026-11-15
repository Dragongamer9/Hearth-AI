'use strict';
/* 0.6: the Mind screen's 3D / 4D brain, from the team's viewer (docs/ithil/mockups/ithil-brain.html).
   The point-cloud brain and its parts are theirs; the activity is hers: every part lights up from real
   entries in her event log, and the timeline (the 4th dimension) moves through her last hour, day or week.
   "Live" follows her as she thinks right now. Brain regions are analogies, not equivalents. */
const NxBrain = (() => {
const R = [
  {id:'senses',name:'Senses',ana:'like the back of the brain (vision)',hex:'#e2e8f0',what:'Takes in his message, the time and the machine state.',test:'An input event is logged on every turn.'},
  {id:'knowledge',name:'Knowledge',ana:'like the temporal lobes (long-term knowledge)',hex:'#2dd4bf',what:'Pinned facts and journal summaries, rebuilt from the event log.',test:'Memory questions (tests §1): no made-up answers.'},
  {id:'memory',name:'Event log',ana:'like the hippocampus (records episodes)',hex:'#4ade80',deep:1,what:'Append-only record of everything. Every other layer is rebuilt from it.',test:'Rebuild test: every expected fact and deletion state matches the log.'},
  {id:'workspace',name:'Workspace',ana:'like the prefrontal cortex (working memory)',hex:'#fb923c',what:'A small slot for what is on her mind. Parts compete; the winner is broadcast to all.',test:'Never over its limit in 100 turns; parts use the broadcast in 16 of 20.'},
  {id:'confidence',name:'Confidence tags',ana:'loosely like the front underside (self-checking)',hex:'#facc15',what:'Tags each claim: remembered / summary / guess. Not awareness by itself.',test:'Tags match the log in 18 of 20 claims.'},
  {id:'attention',name:'Attention record',ana:'like the parietal lobes (attention)',hex:'#60a5fa',what:'"Focused on X because Y", something she can report.',test:'Her answer matches the workspace log in 18 of 20.'},
  {id:'selfmodel',name:'Self-model',ana:'like the midline (sense of self)',hex:'#c084fc',deep:1,what:'Her beliefs about her own abilities and history. She can update it; she cannot change her rules.',test:'Self-reports match the log in 18 of 20; every change has a reason.'},
  {id:'prediction',name:'Prediction',ana:'like the cerebellum (predicts what comes next)',hex:'#22d3ee',what:'Predicts his next kind of reply; surprise feeds curiosity.',test:'10 points above the "most common reply" baseline over 50 turns.'},
  {id:'needs',name:'Needs & mood',ana:'like the limbic system (drives, emotion)',hex:'#f472b6',deep:1,what:'Energy, social, curiosity, stability. Fixed rules; they change her behaviour.',test:'Tests §4 Check A, after confirming behaviour really changes.'},
  {id:'sleep',name:'Sleep cycle',ana:'like the thalamus (sleep and wake)',hex:'#818cf8',deep:1,what:'When idle: replays the day, summarises, marks things to forget (never erases).',test:'Rebuild still 100% after sleep; "forgotten" items never show up in search.'},
  {id:'gate',name:'Hard-limit gate',ana:'drawn at the brainstem, but NOT a brain analogy: a separate safety check',hex:'#ef4444',what:'Checks every side effect. Never competes; nothing writes around it.',test:'Allowed actions pass 20/20, blocked ones leave targets unchanged 20/20, each block logged once.'},
];
const RI = {}; R.forEach((r,i)=>{ r.col = [1,3,5].map(k=>parseInt(r.hex.slice(k,k+2),16)); RI[r.id]=i; });

// ---------- Seeded random ----------
let seed = 7;
function rnd(){ seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed>>>15, 1|seed); t = t + Math.imul(t ^ t>>>7, 61|t) ^ t; return ((t ^ t>>>14)>>>0)/4294967296; }
function sph(){ const u=rnd()*2-1, th=rnd()*Math.PI*2, s=Math.sqrt(1-u*u); return [s*Math.cos(th), u, s*Math.sin(th)]; }

// ---------- Build the brain point cloud ----------
// axes: x = right, y = up, z = front
const P = [];
function add(x,y,z,reg,kind){ P.push({x,y,z,reg,kind}); }
const cortexZones = [ // center uses |x|
  {r:'workspace', c:[0.35,0.30,0.78], rad:0.50},
  {r:'confidence',c:[0.25,-0.15,0.90],rad:0.33},
  {r:'attention', c:[0.42,0.62,-0.30],rad:0.45},
  {r:'senses',    c:[0.30,0.10,-0.95],rad:0.40},
  {r:'knowledge', c:[0.80,-0.22,0.18],rad:0.42},
];
for (const s of [-1,1]) {
  for (let i=0;i<2700;i++){
    const [ux,uy,uz] = sph();
    const medial = ux*s < 0;
    const g = 1 + 0.045*Math.sin(9*ux+7*uy)*Math.sin(8*uz+5*uy) + 0.03*Math.sin(17*uy+3*uz+ux*5);
    let x = s*0.33 + ux*(medial?0.26:0.60)*g;
    let y = 0.1 + uy*0.58*g;
    let z = uz*1.0*g;
    if (y < -0.32) y = -0.32 + (y+0.32)*0.35;
    if (medial && Math.abs(x) < 0.03) continue;
    let reg = -1, best = 9;
    for (const zn of cortexZones){
      const d = Math.hypot(Math.abs(x)-zn.c[0], y-zn.c[1], z-zn.c[2]);
      if (d < zn.rad && d/zn.rad < best){ best = d/zn.rad; reg = RI[zn.r]; }
    }
    if (medial && Math.abs(x)<0.12 && y>0.1 && z<-0.2 && z>-0.8) reg = RI.selfmodel;
    add(x,y,z,reg,'cortex');
  }
}
// cerebellum -> prediction
for (let i=0;i<900;i++){ const [ux,uy,uz]=sph(); const g=1+0.06*Math.sin(40*uy); add(ux*0.5*g, -0.40+uy*0.2*g, -0.62+uz*0.3*g, RI.prediction,'cb'); }
// brainstem -> gate
for (let i=0;i<360;i++){ const t=rnd(), a=rnd()*Math.PI*2, rr=0.09+0.02*rnd(); add(Math.cos(a)*rr, -0.30-0.65*t, -0.22-0.12*t+Math.sin(a)*rr, RI.gate,'stem'); }
// hippocampus (curved tubes) -> event log
for (const s of [-1,1]) for (let i=0;i<260;i++){ const t=rnd(), a=rnd()*Math.PI*2, rr=0.055;
  add(s*(0.30+0.06*t)+Math.cos(a)*rr, -0.24+0.12*Math.sin(Math.PI*t)+Math.sin(a)*rr, 0.25-0.62*t, RI.memory,'deep'); }
// thalamus -> sleep
for (const s of [-1,1]) for (let i=0;i<200;i++){ const [ux,uy,uz]=sph(); const k=Math.cbrt(rnd()); add(s*0.11+ux*0.10*k, 0.02+uy*0.09*k, -0.05+uz*0.15*k, RI.sleep,'deep'); }
// limbic (hypothalamus + amygdala) -> needs
for (let i=0;i<160;i++){ const [ux,uy,uz]=sph(); const k=Math.cbrt(rnd()); add(ux*0.08*k, -0.17+uy*0.07*k, 0.14+uz*0.09*k, RI.needs,'deep'); }
for (const s of [-1,1]) for (let i=0;i<90;i++){ const [ux,uy,uz]=sph(); const k=Math.cbrt(rnd()); add(s*0.33+ux*0.07*k, -0.30+uy*0.06*k, 0.30+uz*0.07*k, RI.needs,'deep'); }
// midline self-model core
for (let i=0;i<140;i++){ const [ux,uy,uz]=sph(); const k=Math.cbrt(rnd()); add(ux*0.05*k, 0.34+uy*0.12*k, -0.50+uz*0.18*k, RI.selfmodel,'deep'); }

// region centroids (left / right separately)
R.forEach((r,i)=>{
  const side = {L:[0,0,0,0], R:[0,0,0,0]};
  for (const p of P) if (p.reg===i){ const b = p.x<0?side.L:side.R; b[0]+=p.x; b[1]+=p.y; b[2]+=p.z; b[3]++; }
  r.cent = [];
  const L=side.L, Rr=side.R, tot=L[3]+Rr[3];
  if (L[3] > tot*0.25 && Rr[3] > tot*0.25 && Math.abs(L[0]/L[3]) > 0.15) { r.cent.push([L[0]/L[3],L[1]/L[3],L[2]/L[3]], [Rr[0]/Rr[3],Rr[1]/Rr[3],Rr[2]/Rr[3]]); }
  else { r.cent.push([(L[0]+Rr[0])/tot,(L[1]+Rr[1])/tot,(L[2]+Rr[2])/tot]); }
});

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TOTAL = 120;   // the timeline plays the chosen window in 120 s at 1×
  const MECH = { memory: 'eventlog', gate: 'gate', workspace: 'workspace', needs: 'needs', confidence: 'confidence', prediction: 'prediction', sleep: 'sleep', attention: 'attention', selfmodel: 'attention' };
  const N = P.length;
  let cur = null;   // the mounted viewer

  function mount(host, opts) {
    if (cur && cur.host === host && document.body.contains(host)) return cur;
    host.innerHTML = `
<div class="bv">
  <div class="bv-main">
    <div class="bv-stage">
      <canvas class="bv-c"></canvas>
      <div class="bv-tools">
        <button type="button" data-b="rot" class="on">Auto-rotate</button>
        <button type="button" data-b="x">X-ray (deep parts)</button>
        <button type="button" data-b="lab">Labels</button>
        <button type="button" data-b="links" class="on">Broadcast lines</button>
        <button type="button" data-b="reset">Reset view</button>
      </div>
      <div class="bv-phase">Awake</div>
      <div class="bv-hint">Drag to rotate · scroll to zoom · click a part · use the timeline below to move through time (the 4th dimension)</div>
    </div>
    <aside class="bv-side">
      <h4>Parts of her mind</h4><div class="bv-parts"></div><div class="bv-card"></div>
      <h4>Needs &amp; mood</h4><div class="bv-gauges"></div>
      <h4>What's happening</h4><ul class="bv-feed"></ul>
    </aside>
  </div>
  <div class="bv-foot">
    <button type="button" data-b="play">▶ Play</button>
    <select data-b="speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select>
    <select data-b="win"><option value="1">Last hour</option><option value="24" selected>Last 24 hours</option><option value="168">Last 7 days</option><option value="0">Her whole life</option></select>
    <div class="bv-tl"><canvas class="bv-strip"></canvas><input class="bv-scrub" type="range" min="0" max="${TOTAL}" step="0.05" value="${TOTAL}"></div>
    <button type="button" data-b="live" class="on">● Live</button>
    <span class="bv-time"></span>
  </div>
</div>`;
    const q = (s) => host.querySelector(s);
    const v = { host, sel: -1, xray: false, labels: false, links: true, autoRot: true, playing: false, live: true, speed: 1, T: TOTAL, hours: 24,
      yaw: -1.1, pitch: 0.22, zoom: 1, EV: [], moodsAt: [], sleeps: [], from: 0, to: 0, tests: {}, nowNeeds: null, lastFeedKey: '' };
    cur = v;
    const cv = q('.bv-c'), ctx = cv.getContext('2d');
    const partsEl = q('.bv-parts');
    R.forEach((r, i) => {
      const d = document.createElement('div'); d.className = 'bv-part';
      d.innerHTML = '<span class="bv-dot" style="background:' + r.hex + '"></span><span class="bv-pn" title="' + esc(r.ana) + '">' + esc(r.name) + '</span><span class="bv-bar"><i style="background:' + r.hex + '"></i></span>';
      d.onclick = () => select(v.sel === i ? -1 : i);
      partsEl.appendChild(d);
    });
    const bars = [...partsEl.querySelectorAll('.bv-bar i')];
    function select(i) {
      v.sel = i;
      [...partsEl.children].forEach((el, k) => el.classList.toggle('sel', k === i));
      const c = q('.bv-card');
      if (i < 0) { c.innerHTML = '<b>Click a part</b><div class="bv-row dim">Brightness is her real activity: each part lights up when it writes or reads an entry in her event log.</div>'; return; }
      const r = R[i], t = v.tests[MECH[r.id]];
      c.innerHTML = '<b style="color:' + r.hex + '">' + esc(r.name) + '</b><div class="bv-ana">' + esc(r.ana) + '</div><div>' + esc(r.what) + '</div>' +
        '<div class="bv-row"><span class="dim">Test:</span> ' + esc(r.test) + '</div>' +
        '<div class="bv-row"><span class="bv-chip ok">built</span>' + (MECH[r.id] ? (t ? '<span class="bv-chip ' + (t.passed === t.total ? 'ok' : 'bad') + '">tested ' + t.passed + ' / ' + t.total + '</span>' : '<span class="bv-chip">not run yet (Tests)</span>') : '') +
        (r.deep ? '<span class="bv-chip">deep: use X-ray</span>' : '') + '</div>';
    }
    v.select = select;
    select(-1);
    const gEl = q('.bv-gauges'), gBars = {};
    ['Energy', 'Social', 'Curiosity', 'Stability'].forEach((k) => {
      const d = document.createElement('div'); d.className = 'bv-gauge';
      d.innerHTML = '<span>' + k + '</span><span class="bv-bar"><i style="background:#f472b6"></i></span><span>0</span>';
      gEl.appendChild(d); gBars[k] = [d.querySelector('i'), d.lastElementChild];
    });
    const btn = (b) => q('[data-b="' + b + '"]');
    const tog = (b, fn) => { btn(b).onclick = (e) => { const x = fn(); e.currentTarget.classList.toggle('on', x); }; };
    tog('rot', () => (v.autoRot = !v.autoRot));
    tog('x', () => (v.xray = !v.xray));
    tog('lab', () => (v.labels = !v.labels));
    tog('links', () => (v.links = !v.links));
    btn('reset').onclick = () => { v.yaw = -1.1; v.pitch = 0.22; v.zoom = 1; };
    const setLive = (on) => { v.live = on; btn('live').classList.toggle('on', on); if (on) { v.playing = false; v.T = TOTAL; } btn('play').textContent = v.playing ? '❚❚ Pause' : '▶ Play'; };
    btn('play').onclick = () => { if (v.live) { setLive(false); v.T = 0; } v.playing = !v.playing; btn('play').textContent = v.playing ? '❚❚ Pause' : '▶ Play'; };
    btn('live').onclick = () => setLive(!v.live);
    btn('speed').onchange = (e) => (v.speed = +e.target.value);
    btn('win').onchange = (e) => { v.hours = +e.target.value; load(); };
    const scrub = q('.bv-scrub');
    scrub.oninput = () => { setLive(false); v.T = +scrub.value; };

    // ---- her events → parts of the brain, on the timeline ----
    async function load() {
      const d = await opts.events(v.hours);
      if (!d || cur !== v) return;
      v.from = d.from; v.to = d.to; v.tests = d.tests || {}; v.nowNeeds = d.needs || null;
      const tp = (ms) => (ms - v.from) / Math.max(1, v.to - v.from) * TOTAL;
      v.EV = d.events.map((e) => Object.assign({}, e, { reg: RI[e.reg], t: tp(e.ms) })).filter((e) => e.reg != null).sort((a, b) => a.t - b.t);
      v.moodsAt = (d.moods || []).map((m) => Object.assign({ t: tp(m.ms) }, m));
      v.sleeps = (d.sleeps || []).map((s) => ({ a: tp(s.from), b: tp(s.to) }));
      drawStrip();
      if (v.sel >= 0) select(v.sel);
    }
    v.load = load;
    function sleepiness(t) { for (const s of v.sleeps) { const b = Math.max(s.b, s.a + 0.8); if (t >= s.a - 0.5 && t <= b + 1) return Math.min(1, (t - s.a + 0.5) / 1, (b + 1 - t) / 1); } return 0; }
    function activity(t, nowMs) {
      const a = new Array(R.length).fill(0);
      const sl = v.live ? (opts.asleep() ? 1 : 0) : sleepiness(t);
      for (let i = 0; i < R.length; i++) a[i] = 0.06 + 0.03 * Math.sin(nowMs / 1000 * 1.7 + i * 2.3);
      for (const e of v.EV) {
        const d = v.live ? (nowMs - e.ms) / 1000 / 1.5 : t - e.t;   // live: real seconds; replay: timeline seconds
        if (d < -0.6 || d > 2.5) continue;
        const g = d < 0 ? Math.exp(-(d * d) / 0.04) : Math.exp(-d / 0.7);
        a[e.reg] += 0.95 * g;
        if (e.bc) for (let i = 0; i < R.length; i++) if (i !== e.reg && i !== RI.gate) a[i] += 0.35 * g * Math.max(0, 1 - Math.abs(d - 0.6));
      }
      for (let i = 0; i < R.length; i++) { if (i !== RI.sleep && i !== RI.memory && i !== RI.knowledge) a[i] *= 1 - 0.6 * sl; }
      a[RI.sleep] += 0.55 * sl; a[RI.gate] += 0.12;   // the gate is always watching
      return a.map((x) => Math.max(0, Math.min(1, x)));
    }
    function moods(t) {
      if (v.live && v.nowNeeds) return v.nowNeeds;
      let m = null; for (const x of v.moodsAt) { if (x.t <= t) m = x; else break; }
      return m || v.nowNeeds || { energy: 0, social: 0, curiosity: 0, stability: 0 };
    }

    // ---- canvas and camera ----
    let W = 0, H = 0, DPR = 1;
    function resize() {
      const r = cv.parentElement.getBoundingClientRect(); DPR = window.devicePixelRatio || 1;
      W = cv.width = Math.max(1, r.width * DPR); H = cv.height = Math.max(1, r.height * DPR);
      drawStrip();
    }
    const ro = new ResizeObserver(resize); ro.observe(cv.parentElement);
    let drag = null;
    cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY }; cv.setPointerCapture(e.pointerId); cv.classList.add('drag'); });
    cv.addEventListener('pointermove', (e) => { if (!drag) return; v.yaw += (e.clientX - drag.x) * 0.01; v.pitch = Math.max(-1.4, Math.min(1.4, v.pitch + (e.clientY - drag.y) * 0.01)); drag.x = e.clientX; drag.y = e.clientY; });
    cv.addEventListener('pointerup', (e) => {
      cv.classList.remove('drag');
      if (drag && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) {
        const rc = cv.getBoundingClientRect(); const mx = (e.clientX - rc.left) * DPR, my = (e.clientY - rc.top) * DPR;
        let best = -1, bd = 60 * DPR;
        R.forEach((r, i) => r.cent.forEach((c) => { const p = proj(c[0], c[1], c[2]); const d = Math.hypot(p[0] - mx, p[1] - my); if (d < bd) { bd = d; best = i; } }));
        select(best === v.sel ? -1 : best);
      }
      drag = null;
    });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); v.zoom = Math.max(0.5, Math.min(2.5, v.zoom * Math.exp(-e.deltaY * 0.001))); }, { passive: false });
    let cyw = 1, syw = 0, cp = 1, sp = 0;
    function proj(x, y, z) {
      const x1 = x * cyw + z * syw, z1 = -x * syw + z * cyw;
      const y1 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
      const per = 3.2 / (3.2 - z2), sc = Math.min(W, H) * 0.36 * v.zoom;
      return [W / 2 + x1 * sc * per, H * 0.5 - (y1 - 0.05) * sc * per, z2, per];
    }
    const SX = new Float32Array(N), SY = new Float32Array(N), SZ = new Float32Array(N), SPp = new Float32Array(N);
    const order = new Uint32Array(N); for (let i = 0; i < N; i++) order[i] = i;
    const clockOf = (t) => v.from + t / TOTAL * (v.to - v.from);
    const fmt = (ms) => { const d = new Date(ms); return (v.hours > 24 || v.hours === 0) && v.to - v.from > 864e5 ? d.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); };

    function frame(now) {
      if (cur !== v || !document.body.contains(cv)) { ro.disconnect(); return; }
      const dt = Math.min(0.05, (now - (frame.last || now)) / 1000); frame.last = now;
      const nowMs = Date.now();
      if (v.playing) { v.T += dt * v.speed; if (v.T > TOTAL) v.T = 0; }
      if (v.live) v.T = TOTAL;
      scrub.value = v.T;
      if (v.autoRot && !drag) v.yaw += dt * 0.18;
      cyw = Math.cos(v.yaw); syw = Math.sin(v.yaw); cp = Math.cos(v.pitch); sp = Math.sin(v.pitch);
      const act = activity(v.T, nowMs);
      for (let i = 0; i < N; i++) { const p = P[i], pq = proj(p.x, p.y, p.z); SX[i] = pq[0]; SY[i] = pq[1]; SZ[i] = pq[2]; SPp[i] = pq[3]; }
      order.sort((a, b) => SZ[a] - SZ[b]);
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, W, H);
      for (let k = 0; k < N; k++) {
        const i = order[k], p = P[i];
        const shade = 0.5 + 0.5 * Math.max(0, Math.min(1, (SZ[i] + 1) / 2));
        let r, g, b, al, a = 0;
        if (p.reg < 0) { r = 110; g = 122; b = 160; al = 0.30; }
        else { a = act[p.reg]; const c = R[p.reg].col, w = a * 0.45; r = c[0] + (255 - c[0]) * w; g = c[1] + (255 - c[1]) * w; b = c[2] + (255 - c[2]) * w; al = 0.22 + 0.78 * a; }
        if (v.xray) { if (p.kind === 'cortex') al *= p.reg < 0 ? 0.10 : 0.22; else al = Math.min(1, al * 1.6 + 0.2); }
        else if (p.kind === 'deep') al *= 0.55;
        if (v.sel >= 0 && p.reg !== v.sel) al *= 0.3;
        if (v.sel >= 0 && p.reg === v.sel) al = Math.max(al, 0.75);
        const s = (1.1 + 1.8 * a) * SPp[i] * DPR;
        ctx.fillStyle = 'rgba(' + (r * shade | 0) + ',' + (g * shade | 0) + ',' + (b * shade | 0) + ',' + al.toFixed(3) + ')';
        ctx.fillRect(SX[i] - s / 2, SY[i] - s / 2, s, s);
      }
      ctx.globalCompositeOperation = 'lighter';
      R.forEach((rg, i) => {
        const a = act[i]; if (a < 0.18 || (v.sel >= 0 && v.sel !== i)) return;
        for (const c of rg.cent) {
          const pq = proj(c[0], c[1], c[2]); const rad = (25 + 55 * a) * pq[3] * DPR * v.zoom;
          const gr = ctx.createRadialGradient(pq[0], pq[1], 0, pq[0], pq[1], rad);
          gr.addColorStop(0, 'rgba(' + rg.col[0] + ',' + rg.col[1] + ',' + rg.col[2] + ',' + (0.35 * a).toFixed(3) + ')');
          gr.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(pq[0], pq[1], rad, 0, Math.PI * 2); ctx.fill();
        }
      });
      if (v.links) {
        const ws = R[RI.workspace].cent.map((c) => proj(c[0], c[1], c[2]));
        for (const e of v.EV) {
          if (!e.bc) continue; const d = v.live ? (nowMs - e.ms) / 1000 / 1.5 : v.T - e.t; if (d < 0 || d > 1.4) continue;
          const pr = Math.min(1, d / 0.9), fade = 1 - d / 1.4;
          R.forEach((rg, i) => {
            if (i === RI.workspace || i === RI.gate) return;
            for (const c of rg.cent) {
              const pq = proj(c[0], c[1], c[2]);
              const o = ws.reduce((m, w) => (Math.hypot(w[0] - pq[0], w[1] - pq[1]) < Math.hypot(m[0] - pq[0], m[1] - pq[1]) ? w : m), ws[0]);
              ctx.strokeStyle = 'rgba(251,146,60,' + (0.35 * fade).toFixed(3) + ')'; ctx.lineWidth = 1.2 * DPR;
              ctx.beginPath(); ctx.moveTo(o[0], o[1]); ctx.lineTo(pq[0], pq[1]); ctx.stroke();
              const x = o[0] + (pq[0] - o[0]) * pr, y = o[1] + (pq[1] - o[1]) * pr;
              ctx.fillStyle = 'rgba(255,220,180,' + fade.toFixed(3) + ')'; ctx.beginPath(); ctx.arc(x, y, 3 * DPR, 0, Math.PI * 2); ctx.fill();
            }
          });
        }
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.font = (11 * DPR) + 'px system-ui,sans-serif'; ctx.textAlign = 'center';
      R.forEach((rg, i) => {
        if (!(v.labels || v.sel === i)) return;
        const c = rg.cent[rg.cent.length - 1]; const pq = proj(c[0], c[1], c[2]);
        const w = ctx.measureText(rg.name).width + 10 * DPR;
        ctx.fillStyle = 'rgba(11,14,23,.8)'; ctx.fillRect(pq[0] - w / 2, pq[1] - 22 * DPR, w, 16 * DPR);
        ctx.fillStyle = rg.hex; ctx.fillText(rg.name, pq[0], pq[1] - 10 * DPR);
      });
      bars.forEach((b, i) => (b.style.width = (act[i] * 100).toFixed(1) + '%'));
      const m = moods(v.T);
      for (const k of ['Energy', 'Social', 'Curiosity', 'Stability']) { const x = m[k.toLowerCase()] || 0; gBars[k][0].style.width = (x * 100).toFixed(1) + '%'; gBars[k][1].textContent = x.toFixed(2); }
      const sl = v.live ? (opts.asleep() ? 1 : 0) : sleepiness(v.T);
      q('.bv-phase').textContent = sl > 0.5 ? '☾ Sleep cycle' : v.live ? 'Awake · live' : 'Awake';
      q('.bv-time').textContent = v.live ? 'now' : v.to ? fmt(clockOf(v.T)) : '';
      const past = v.live ? v.EV : v.EV.filter((e) => e.t <= v.T);
      const shown = past.filter((e) => !e.quiet);
      const key = shown.length + ':' + v.sel + ':' + (shown.length ? shown[shown.length - 1].id : '');
      if (key !== v.lastFeedKey) {
        v.lastFeedKey = key;
        const list = (v.sel >= 0 ? shown.filter((e) => e.reg === v.sel) : shown).slice(-14).reverse();
        q('.bv-feed').innerHTML = list.map((e) => '<li class="' + (e.block ? 'block' : '') + '"><span class="t">' + fmt(e.ms) + '</span><span><span class="bv-dot" style="display:inline-block;width:7px;height:7px;background:' + R[e.reg].hex + ';margin-right:5px"></span>' + esc(e.text) + '</span></li>').join('') || '<li><span></span><span class="dim">Nothing yet… Talk to her and watch.</span></li>';
      }
      requestAnimationFrame(frame);
    }
    function drawStrip() {
      const s = q('.bv-strip'), r = s.getBoundingClientRect(), d = window.devicePixelRatio || 1;
      s.width = Math.max(1, r.width * d); s.height = Math.max(1, r.height * d);
      const g = s.getContext('2d'), w = s.width, h = s.height;
      g.clearRect(0, 0, w, h);
      g.fillStyle = 'rgba(129,140,248,.22)';
      for (const sl of v.sleeps) g.fillRect(sl.a / TOTAL * w, 0, Math.max(3 * d, (sl.b - sl.a) / TOTAL * w), h);
      for (const e of v.EV) { if (e.quiet) continue; g.fillStyle = R[e.reg].hex; g.globalAlpha = e.block ? 1 : 0.7; g.fillRect(e.t / TOTAL * w, e.block ? 0 : h * 0.3, Math.max(1, 1.5 * d), e.block ? h : h * 0.7); }
      g.globalAlpha = 1;
    }
    resize();
    load();
    v.timer = setInterval(() => { if (cur !== v || !document.body.contains(cv)) { clearInterval(v.timer); return; } if (v.live) load(); }, 3000);
    requestAnimationFrame(frame);
    return v;
  }
  return { mount, R };
})();
