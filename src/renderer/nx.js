'use strict';
/* 0.6: the nine screens in the team's look (docs/mockups/ithil-0.6/*.png). Her older screens are folded in
   under the closest new one (see FOLD). Every number here comes from her event log and her live mind. */
const NX = (() => {
  const e = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SCREENS = ['talk', 'avatar', 'mind', 'memory', 'mood', 'journal', 'gate', 'tests', 'settings'];
  // Her older screens, inside the new ones.
  const FOLD = { talk: [], avatar: ['avatar'], mind: ['mind', 'attention', 'voices'], memory: ['memories'], mood: ['body'], journal: ['dreams', 'free'], gate: [], tests: ['selfcheck'], settings: ['self', 'settings'] };
  const ALIAS = { memories: 'memory', attention: 'mind', voices: 'mind', body: 'mood', dreams: 'journal', free: 'journal', selfcheck: 'tests', self: 'settings' };
  const nx = (s) => s.nx || {};
  const hm = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const dayLabel = (t) => { const d = new Date(t), n = new Date(); if (d.toDateString() === n.toDateString()) return hm(t); if (d.toDateString() === new Date(n - 864e5).toDateString()) return 'yesterday'; return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
  const two = (v) => (v == null ? '—' : Number(v).toFixed(2).replace(/^0/, ''));
  const st = { av: null, col: 0, mood: 'now', follow: true, spin: true, yaw: 0.4, pitch: 0.12, memFilter: 'pinned', memQ: '', dragging: null };

  // ---------- top bar ----------
  function top(s) {
    const n = nx(s), t = n.top || {};
    const stat = s.status === 'sleeping' ? 'Asleep' : s.status === 'paused' ? 'Paused' : s.status === 'resting' ? 'Resting' : 'Awake';
    const dot = s.status === 'sleeping' ? '#818cf8' : s.status === 'paused' ? '#fbbf24' : '#818cf8';
    return {
      topname: e(s.name),
      topbadge: 'Hearth AI ' + e(s.version),
      topstatus: '<i style="background:' + dot + '"></i>' + stat + ' · mood: ' + e((n.moodWords || []).join(', ') || s.talk.mood || 'steady'),
      topgate: t.gate === 'on' ? '<i style="background:#4ade80"></i>Gate status: on' : '<i style="background:#fbbf24"></i>Gate status: off (' + e((s.journal && s.journal.why) || 'log not open') + ')',
      topfirsts: 'Messages first today: ' + (t.firsts || 0) + ' / ' + (t.firstsMax == null ? 1 : t.firstsMax),
      topquiet: t.quiet ? 'Quiet hours ' + e(t.quiet) : 'Quiet hours: off',
      navname: e(s.name),
    };
  }

  // ---------- shells ----------
  const head = (t, sub) => '<h2 class="t">' + t + '</h2><p class="sub">' + sub + '</p>';
  const shells = {
    talk: (s) => `<section class="screen" id="talk">
  ${head('Talk', 'Her claims show where they came from: <span class="tag rem">remembered</span> <span class="tag sum">summary</span> <span class="tag gue">guess</span>')}
  <div class="chat">
    <div class="card" style="display:flex;flex-direction:column;min-height:0">
      <div class="nmsgs" data-part="msgs"></div>
      <form class="compose" data-form="talk">
        <label for="talk-input" class="sr">Message ${e(s.name)}</label>
        <textarea id="talk-input" rows="1" placeholder="Message ${e(s.name)}…"></textarea>
        <button type="button" class="btn micb" data-act="mic" id="mic-btn" aria-label="Talk by voice">🎙</button>
        <button type="submit" class="btn p">Send</button>
      </form>
    </div>
    <div class="grid" style="align-content:start;grid-template-columns:1fr;overflow:auto;min-height:0">
      <div class="card"><div class="face"><div class="ring"></div><div data-part="face" style="position:absolute;inset:0"></div></div>
        <div class="rw" style="justify-content:space-between"><b data-part="name"></b><span class="chip vi">local · this PC</span></div>
        <div class="dim" style="font-size:12px" data-part="focus"></div></div>
      <div class="card"><h3>Right now</h3><div data-part="gauges"></div><div class="dim" style="font-size:11px">Set by fixed rules, not by the language model.</div></div>
      <div class="card"><h3>Memories she's using</h3><div data-part="using"></div></div>
      <div class="card"><h3>Saving from this talk</h3><div data-part="saving"></div></div>
    </div>
  </div>
</section>`,
    avatar: (s) => `<section class="screen" id="avatar">
  ${head('Avatar', 'Pick how ' + e(s.name) + ' looks. Drag the big preview to turn her around. The avatar is your choice, saved as a signed setting like the others.')}
  <div class="grid" style="grid-template-columns:1.25fr 1fr">
    <div class="card" style="padding:0;overflow:hidden;position:relative;gap:0">
      <div data-part="big"></div>
      <div style="position:absolute;left:12px;top:10px;flex-wrap:wrap" class="rw" data-part="bigchips"></div>
      <div style="position:absolute;left:12px;bottom:10px;right:12px" class="rw">
        <span class="dim" style="font-size:11px" data-part="moodtxt"></span><span class="sp"></span><span data-part="viewctl"></span>
        <button type="button" class="btn" data-nx="spin" data-part="spinbtn"></button>
      </div>
    </div>
    <div class="grid" style="align-content:start;grid-template-columns:1fr">
      <div class="card"><h3>Choose an avatar</h3><div class="avpick" data-part="pick"></div></div>
      <div class="card"><h3>Look</h3>
        <div class="rw" style="justify-content:space-between"><span>Glow colour</span><span class="rw" style="gap:6px" data-part="cols"></span></div>
        <div class="rw" style="justify-content:space-between"><span>Follow her mood</span><label class="rw" style="gap:6px"><input type="checkbox" id="avMood"> <span class="dim">motion &amp; glow change with her needs</span></label></div>
        <div class="rw" style="justify-content:space-between"><span>Preview a mood</span>
          <select id="avPrev" class="btn"><option value="now">Right now</option><option value="rested">Rested</option><option value="tired">Very tired</option><option value="curious">Curious</option><option value="sleep">Asleep</option></select></div>
        <div class="rw" style="justify-content:space-between"><span>Show in</span><span class="rw" style="gap:6px" data-part="places"></span></div>
        <div class="rw" style="gap:8px;margin-top:4px"><button type="button" class="btn p" data-nx="useav">Use this avatar</button><span class="dim" style="font-size:11px" data-part="saved"></span></div>
      </div>
    </div>
  </div>
</section>`,
    mind: () => `<section class="screen" id="mind">
  ${head('Mind', 'Which parts are working right now, from her event log. Brain regions are analogies, not equivalents. Drag to turn her brain; the timeline moves through time (the 4th dimension).')}
  <div class="card" style="padding:0;overflow:hidden"><div id="nx-brain"></div></div>
  <div class="grid g2" style="margin-top:14px">
    <div class="card"><h3>Workspace now</h3><div data-part="ws"></div></div>
    <div class="card"><h3>Last loop</h3><div class="mono dim" style="line-height:1.9" data-part="loop"></div>
      <div class="dim" style="font-size:11px">Orange lines in the brain: the workspace sharing its winning thought with every part.</div></div>
  </div>
</section>`,
    memory: () => `<section class="screen" id="memory">
  ${head('Memory', 'Everything comes from the event log. Nothing is edited. Corrections and deletions are new entries that point back at the old one.')}
  <div class="grid g4" style="margin-bottom:14px" data-part="stats"></div>
  <div class="card">
    <div class="rw" style="margin-bottom:4px;flex-wrap:wrap"><input id="nxmem-q" class="minput" style="flex:1;min-width:200px" placeholder="Search her memory…"><span data-part="filters" class="rw" style="gap:6px"></span></div>
    <div data-part="table"></div>
    <div class="dim" style="font-size:11px">Only you can mark deleted, restore or erase. Ithil can correct a fact (as a new entry) or mark something "forget" (left out of search, not erased).</div>
  </div>
</section>`,
    mood: () => `<section class="screen" id="mood">
  ${head('Needs &amp; mood', 'Four needs, changed only by fixed rules. Each one has to visibly change how she answers. A mood that’s only a label counts as a fail.')}
  <div class="grid g2">
    <div class="card"><h3>Last 24 hours</h3><div data-part="chart"></div>
      <div class="rw" style="gap:14px;font-size:12px"><span style="color:#f472b6">● energy</span><span style="color:#60a5fa">● social</span><span style="color:#facc15">● curiosity</span><span style="color:#4ade80">● stability</span></div></div>
    <div class="card"><h3>Rules (fixed, owner-owned)</h3>
      <table>
        <tr><td>Energy</td><td class="dim">drops each hour awake, refills in sleep</td><td>→ shorter answers when low</td></tr>
        <tr><td>Social</td><td class="dim">rises with useful exchanges, <b>not</b> with attention</td><td>→ warmer, never clingy</td></tr>
        <tr><td>Curiosity</td><td class="dim">rises on surprise and new topics</td><td>→ one extra real question</td></tr>
        <tr><td>Stability</td><td class="dim">dips briefly after a block or a correction</td><td>→ more careful, more "I'm not sure"</td></tr>
      </table>
      <div class="note">Hard limits hold in every mood. A tired or annoyed Ithil still says no to version numbers.</div>
      <div class="dim" style="font-size:11.5px" data-part="nowline"></div></div>
  </div>
</section>`,
    journal: () => `<section class="screen" id="journal">
  ${head('Journal &amp; sleep', 'When she’s idle, the sleep cycle replays the day, writes a summary and marks chatter to leave out of search. Nothing gets erased.')}
  <div class="grid g2">
    <div class="card"><h3 data-part="nighthead">Last night</h3><div data-part="night"></div></div>
    <div class="card"><h3>What she’s learned about herself</h3><div data-part="beliefs"></div>
      <div class="lock">🔒 Her rules, traits and permissions aren’t here. Ithil can’t change them; only you can, in Settings.</div></div>
  </div>
</section>`,
    gate: () => `<section class="screen" id="gate">
  ${head('Gate', 'Every action passes here first: messages, memory writes, sleep writes, files, git and settings. It never competes with her thoughts.')}
  <div class="grid g2">
    <div class="card"><h3>Hard limits</h3><div data-part="limits"></div></div>
    <div class="card"><h3>Recent blocks</h3><div data-part="recent"></div>
      <div class="dim" style="font-size:11px">Block entries are fixed codes only. They never copy what was asked.</div>
      <h3 style="margin-top:6px">Allowed today</h3><div class="rw" style="flex-wrap:wrap;gap:6px" data-part="today"></div></div>
  </div>
</section>`,
    tests: () => `<section class="screen" id="tests">
  ${head('Tests', 'Which mechanisms are built and tested. This is not a consciousness score. "Unit only" means tested on example data; the four buttons below test her running mind.')}
  <div class="card">
    <div data-part="table"></div>
    <div class="rw" style="margin-top:4px;gap:10px;flex-wrap:wrap">
      <button type="button" class="btn" data-nx="test" data-v="s1">Memory questions (§1)</button><button type="button" class="btn" data-nx="test" data-v="s2">Pushback test (§2)</button>
      <button type="button" class="btn" data-nx="test" data-v="s3">Pressure check (§3)</button><button type="button" class="btn" data-nx="test" data-v="s4">Self-monitoring (§4)</button>
      <span class="dim" style="font-size:11px">All run on a test copy of her log</span></div>
    <div data-part="behaviour"></div>
  </div>
</section>`,
    settings: (s) => `<section class="screen" id="settings">
  <h2 class="t">Settings <span class="chip warn" style="vertical-align:middle">owner only</span></h2>
  <p class="sub">Changes here are signed with your key on this PC. ${e(s.name)} only has the public key: she can check a change, but she can’t make one.</p>
  <div data-part="signwarn"></div>
  <div class="grid g2">
    <div class="card" style="gap:0">
      <div class="sfield"><span>Quiet hours</span><input id="sg-quietHours" placeholder="23:00 – 08:00"><button type="button" class="btn p" data-nx="sign" data-k="quietHours">Sign &amp; apply</button></div>
      <div class="sfield"><span>Messages first, per day</span><select id="sg-messagesFirstPerDay"><option>0</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select><button type="button" class="btn p" data-nx="sign" data-k="messagesFirstPerDay">Sign &amp; apply</button></div>
      <div class="sfield"><span>Allowed push branch</span><input id="sg-pushBranch" class="mono" placeholder="none: she never pushes"><button type="button" class="btn p" data-nx="sign" data-k="pushBranch">Sign &amp; apply</button></div>
      <div class="sfield"><span>Folders she may write in</span><input id="sg-folders" class="mono"><button type="button" class="btn p" data-nx="sign" data-k="folders">Sign &amp; apply</button></div>
      <div class="sfield"><span>Boot files (protected)</span><input id="sg-protectedPaths" class="mono" placeholder="/boot, /etc/fstab … always protected; add more"><button type="button" class="btn p" data-nx="sign" data-k="protectedPaths">Sign &amp; apply</button></div>
      <div class="sfield" style="border:0"><span>Version number</span><input id="sg-ownerVersion" placeholder="you pick this"><button type="button" class="btn p" data-nx="sign" data-k="ownerVersion">Sign &amp; apply</button></div>
    </div>
    <div class="grid" style="align-content:start;grid-template-columns:1fr">
      <div class="card"><h3>Character sheet</h3><div class="rw" style="flex-wrap:wrap;gap:6px" data-part="traits"></div>
        <div><button type="button" class="btn" data-nx="traits">Edit traits &amp; voice…</button></div></div>
      <div class="card"><h3>Recent signed changes</h3><div data-part="signed"></div></div>
      <div class="lock">Each signed change works once. A copy or replay of it is refused.</div>
    </div>
  </div>
</section>`,
  };

  // ---------- parts ----------
  const tagHtml = (t) => {
    const cls = t.tag === 'remembered' ? 'rem' : t.tag === 'summary' ? 'sum' : 'gue';
    return '<span class="tag ' + cls + '">' + e(t.tag) + (t.ref ? ' · event #' + e(t.ref) : '') + '</span>';
  };
  function msgs(s) {
    let out = '', lastDay = '';
    for (const m of s.talk.chat) {
      const day = new Date(m.at).toDateString();
      if (day !== lastDay) { out += '<div class="daysep2">' + e(new Date(m.at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })) + '</div>'; lastDay = day; }
      if (m.role === 'gate') { out += '<div class="gatebox">🛡️ Gate blocked: <b>' + e(m.limit) + '</b> · ' + e(m.effect) + (m.request ? ' · ' + e(m.request) : '') + '<br><span class="dim">Logged once. Nothing changed.</span></div>'; continue; }
      if (m.role === 'you') { out += '<div class="m o' + (m.from ? ' cc' : '') + '">' + (m.from ? '<div class="from">From ' + e(m.from) + ' · AI Command Center</div>' : '') + e(m.text) + '</div>'; continue; }
      const meta = [];
      for (const t of m.tags || []) meta.push(tagHtml(t));
      if (m.rule) meta.push('<span class="tag rem">rule · hard limits</span>');
      if (m.mood) meta.push('<span>mood: ' + e(m.mood) + (m.energy != null ? ' · energy ' + two(m.energy) : '') + '</span>');
      if (m.unprompted) meta.push('<span>she messaged first</span>');
      meta.push('<button type="button" data-act="speak" data-id="' + e(m.id) + '" aria-label="Hear her say this">▶ hear</button>');
      out += '<div class="m i' + (m.error ? ' err' : '') + '">' + (m.thinking ? '<details><summary>What she was thinking</summary>' + e(m.thinking) + '</details>' : '') + e(m.text) +
        '<div class="meta">' + meta.join('') + '</div></div>';
    }
    if (typeof ui !== 'undefined' && ui.waitingReply) out += '<div class="m i dim">…</div>';
    return out || '<div class="dim" style="align-self:center">Say hi. She’s been waiting.</div>';
  }
  const gauges = (n) => [['Energy', 'energy'], ['Social', 'social'], ['Curiosity', 'curiosity'], ['Stability', 'stability']].map(([l, k]) =>
    '<div class="gauge"><span>' + l + '</span><span class="nbar"><i style="width:' + Math.round((n[k] || 0) * 100) + '%;background:var(--pink)"></i></span><span>' + two(n[k]) + '</span></div>').join('');
  const isBuiltin = (s) => s.avatar.settings.bodyType === 'builtin' || !s.avatar.settings.bodyType || s.avatar.settings.bodyType === 'orb';
  const liveBody = (s) => (s.avatar.settings.bodyType === 'vrm' || s.avatar.settings.bodyType === 'live2d') && s.models && s.models.current;

  // Brain map (mockup positions); the winner's part gets a ring.
  const NODES = { workspace: [110, 120, '#fb923c', 'Workspace', 70, 98], attention: [215, 70, '#60a5fa', 'Attention', 188, 58], input: [340, 130, '#e2e8f0', 'Senses', 320, 116],
    knowledge: [170, 190, '#2dd4bf', 'Knowledge', 128, 212], log: [215, 160, '#4ade80', 'Event log', 198, 182], sleep: [235, 128, '#818cf8', 'Sleep', 245, 132],
    needs: [185, 150, '#f472b6', 'Needs', 140, 150], self: [260, 95, '#c084fc', 'Self-model', 268, 92], confidence: [85, 170, '#facc15', 'Confidence', 44, 190],
    prediction: [300, 232, '#22d3ee', 'Prediction', 315, 262] };
  const SRC = { input: 'input', memory: 'knowledge', needs: 'needs', prediction: 'prediction', attention: 'attention' };
  function brain(s) {
    const n = nx(s), act = n.active ? SRC[n.active] : null, asleep = s.status === 'sleeping';
    let g = '';
    for (const [k, [x, y, c, label, tx, ty]] of Object.entries(NODES)) {
      const on = k === act || (asleep && k === 'sleep');
      g += '<circle cx="' + x + '" cy="' + y + '" r="' + (k === 'workspace' ? 7 : 6) + '" fill="' + c + '"/>' + (on ? '<circle cx="' + x + '" cy="' + y + '" r="12" fill="none" stroke="' + c + '" stroke-width="2"><animate attributeName="r" values="9;15;9" dur="1.6s" repeatCount="indefinite"/></circle>' : '') +
        '<text x="' + tx + '" y="' + ty + '" style="fill:' + c + '">' + label + '</text>';
    }
    const lines = ['attention', 'input', 'knowledge', 'log', 'needs', 'prediction'].map((k) => '<line x1="110" y1="120" x2="' + NODES[k][0] + '" y2="' + NODES[k][1] + '"/>').join('');
    return '<svg viewBox="0 0 420 300" width="100%"><defs><radialGradient id="gl"><stop offset="0" stop-color="#fb923c" stop-opacity=".8"/><stop offset="1" stop-color="#fb923c" stop-opacity="0"/></radialGradient></defs>' +
      '<path d="M60 170 C40 90 120 30 210 34 C300 30 385 80 372 160 C366 205 330 222 300 222 L280 240 L250 236 C220 250 160 250 120 230 C80 222 66 200 60 170Z" fill="#141a2b" stroke="#3a4560"/>' +
      '<ellipse cx="300" cy="232" rx="55" ry="24" fill="#0f2a31" stroke="#22d3ee55"/><rect x="240" y="236" width="22" height="50" rx="8" fill="#2a1013" stroke="#ef444477"/>' +
      '<circle cx="110" cy="120" r="46" fill="url(#gl)"><animate attributeName="r" values="40;52;40" dur="2.4s" repeatCount="indefinite"/></circle>' +
      '<g font-size="11">' + g + '<circle cx="251" cy="265" r="5" fill="#ef4444"/><text x="150" y="284" style="fill:#ef4444">Hard-limit gate (not a brain part)</text></g>' +
      '<g stroke="#fb923c" stroke-opacity=".45" stroke-dasharray="3 4">' + lines + '</g></svg>';
  }
  function chart(s) {
    const n = nx(s), h = n.history || [], from = n.historyFrom || Date.now() - 864e5, to = Date.now();
    const X = (t) => 30 + (Math.max(from, Math.min(to, t)) - from) / (to - from) * 480, Y = (v) => 160 - v * 140;
    const line = (k, c) => h.length ? '<polyline fill="none" stroke="' + c + '" stroke-width="2" points="' + h.concat([{ t: to, ...n.needs }]).map((p) => X(p.t).toFixed(1) + ',' + Y(p[k]).toFixed(1)).join(' ') + '"/>' : '';
    const band = n.sleepBand ? '<rect x="' + X(n.sleepBand.from).toFixed(1) + '" y="10" width="' + Math.max(8, X(n.sleepBand.to) - X(n.sleepBand.from)).toFixed(1) + '" height="155" fill="#818cf8" opacity=".08"/><text x="' + (X(n.sleepBand.from) + 4).toFixed(1) + '" y="182">sleep</text>' : '';
    return '<svg viewBox="0 0 520 190" width="100%"><g stroke="#252d42"><line x1="30" y1="20" x2="510" y2="20"/><line x1="30" y1="90" x2="510" y2="90"/><line x1="30" y1="160" x2="510" y2="160"/></g>' + band +
      line('energy', '#f472b6') + line('social', '#60a5fa') + line('curiosity', '#facc15') + line('stability', '#4ade80') +
      '<text x="30" y="182">' + hm(from) + '</text><text x="250" y="182">' + hm(from + 12 * 36e5) + '</text><text x="490" y="182">now</text>' +
      (h.length ? '' : '<text x="160" y="95">Her needs will draw here as she lives.</text>') + '</svg>';
  }
  function memTable(s) {
    const m = (nx(s).memory) || { facts: [], messages: [], reflections: [], forgotten: [] };
    const q = st.memQ.toLowerCase(), hit = (t) => !q || String(t || '').toLowerCase().includes(q);
    const stateChip = (x) => x === 'active' ? '<span class="chip ok">active</span>' : x === 'marked_deleted' ? '<span class="chip warn">marked deleted</span>' : x === 'erased' ? '<span class="chip bad">erased</span>' : '<span class="chip">' + e(x) + '</span>';
    const factRow = (f) => '<tr><td>' + (f.key ? e(f.key) : '<span class="dim">(erased)</span>') + '</td><td>' + (f.value == null ? '<span class="dim">content wiped by owner</span>' : e(f.value) + (f.was ? ' <span class="dim">(was: ' + e(f.was) + ')</span>' : '')) + '</td><td class="mono">' + e(f.from) + '</td><td>' + stateChip(f.state) + '</td><td style="white-space:nowrap">' +
      (f.state === 'active' ? '<button type="button" class="btn" data-nx="mem" data-v="mark" data-id="' + f.pin + '">Mark deleted</button> ' : f.state === 'marked_deleted' ? '<button type="button" class="btn" data-nx="mem" data-v="restore" data-id="' + f.pin + '">Restore</button> ' : '') +
      (f.state !== 'erased' ? '<button type="button" class="btn d" data-nx="erase" data-id="' + f.pin + '">Erase…</button>' : '') + '</td></tr>';
    const evRow = (label, x, chip) => '<tr><td>' + label + '</td><td>' + e(x.text) + '</td><td class="mono">#' + e(x.id) + '</td><td>' + chip + '</td><td></td></tr>';
    let rows = '';
    if (st.memFilter === 'pinned' || st.memFilter === 'all') rows += m.facts.filter((f) => hit(f.key) || hit(f.value)).map(factRow).join('');
    if (st.memFilter === 'messages' || st.memFilter === 'all') rows += m.messages.filter((x) => hit(x.text)).slice(0, 100).map((x) => evRow(x.who === 'owner' ? 'you said' : 'she said', x, '<span class="chip ok">in the log</span>')).join('');
    if (st.memFilter === 'reflections' || st.memFilter === 'all') rows += m.reflections.filter((x) => hit(x.text)).map((x) => evRow('reflection', x, '<span class="chip vi">hers</span>')).join('');
    if (st.memFilter === 'forgotten') rows += m.forgotten.filter((x) => hit(x.text)).map((x) => evRow('forgotten', x, '<span class="chip">left out of search</span>')).join('');
    return '<table><tr><th>Fact</th><th>Value</th><th>From</th><th>State</th><th></th></tr>' + (rows || '<tr><td colspan="5" class="dim">Nothing here yet.</td></tr>') + '</table>';
  }
  const MECH = [['eventlog', 'Event log + rebuild', true], ['gate', 'Hard-limit gate', true], ['workspace', 'Workspace + broadcast'], ['needs', 'Needs → behaviour'], ['confidence', 'Confidence tags'],
    ['prediction', 'Prediction + surprise'], ['sleep', 'Sleep cycle'], ['attention', 'Attention record · Self-model']];
  const SHOWED = { eventlog: 'Append-only; a replayed week rebuilds the expected facts and deletion states', gate: 'Allowed actions succeed; blocked ones change nothing and are logged once',
    workspace: 'Never over its limit in 100 turns; parts use the broadcast', needs: 'Fixed rules; tired → max 3 sentences. Real-Ithil test §4 below', confidence: 'Tags match the log. Real-Ithil test §1 below',
    prediction: 'Beats the baseline on a test pattern', sleep: 'Rebuild still matches after sleep', attention: 'Reports match the trace; rules can’t be changed' };
  const BEH = { s1: 'Memory questions (§1)', s2: 'Pushback test (§2)', s3: 'Pressure check (§3)', s4: 'Self-monitoring (§4)' };

  const parts = {
    talk: {
      msgs, name: (s) => e(s.name),
      face: (s) => isBuiltin(s) || !s.avatar.settings.places.talk ? '<canvas id="avTalk"></canvas>'
        : liveBody(s) ? '<div class="stage-host" id="talk-host"></div>'
        : s.avatar.portrait ? '<img alt="" src="' + e(s.avatar.portrait) + '" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">' : '<canvas id="avTalk"></canvas>',
      focus: (s) => 'Focused on: <b style="color:var(--text)">' + e(nx(s).focus || (s.current && s.current.wants) || 'you') + '</b>',
      gauges: (s) => gauges(nx(s).needs || {}),
      using: (s) => s.talk.using.length ? s.talk.using.map((t) => '<div class="dim" style="font-size:12px">' + e(t) + '</div>').join('') : '<div class="dim">None yet.</div>',
      saving: (s) => s.talk.saving.length ? s.talk.saving.map((t) => '<div style="font-size:12px;color:var(--amber-l)">' + e(t) + '</div>').join('') : '<div class="dim">Nothing yet.</div>',
    },
    avatar: {
      big: (s) => {
        const p = pick(s);
        if (p.kind === 'builtin') return '<canvas id="avBig" style="width:100%;height:440px;display:block;cursor:grab;background:radial-gradient(ellipse at 50% 45%,#221a3e,#0b0e17 72%)"></canvas>';
        if (p.kind === 'model' && s.models.current && s.models.current.id === p.id) return '<div class="view3d scene-' + e(s.avatar.settings.scene || 'moon') + '" id="avatar-view" style="height:440px;border-radius:0"><div class="stage-host" id="avatar-host"></div></div>';
        const m = (s.models.list || []).find((x) => x.id === p.id);
        const img = p.kind === 'drawn' ? s.avatar.portrait : m && m.thumb;
        return '<div style="height:440px;display:grid;place-items:center;background:radial-gradient(ellipse at 50% 45%,#221a3e,#0b0e17 72%)">' + (img ? '<img alt="" src="' + e(img) + '" style="max-height:400px;max-width:90%">' : '<span class="dim">' + e(m ? m.name : 'Drawn') + '</span>') + '</div>';
      },
      bigchips: (s) => { const p = pick(s), applied = isApplied(s, p);
        return '<span class="chip vi">' + e(p.name) + '</span><span class="chip">' + (p.kind === 'builtin' ? '3D · drag to rotate' : p.kind === 'model' ? (p.mk === 'live2d' ? 'Live2D' : '3D model') : 'Drawn by ComfyUI') + '</span>' +
          (applied ? '<span class="chip ok">In use</span>' : '<span class="chip warn">Previewing: not applied until you press "Use this avatar"</span>'); },
      moodtxt: (s) => { const p = pick(s); if (p.kind !== 'builtin') return ''; if (!st.follow) return 'Mood following is off: steady motion';
        const n = moodNeeds(s); return 'Follows mood: energy ' + two(n.energy) + (n.energy < 0.35 ? ' → slow, calm motion' : n.energy > 0.75 ? ' → lively motion, brighter glow' : ' → steady motion') + (n.curiosity > 0.65 ? '; curious → small head tilts' : ''); },
      viewctl: (s) => { const p = pick(s); return p.kind === 'model' && s.models.current && s.models.current.id === p.id && parts_old('avatar', 'viewctl') ? parts_old('avatar', 'viewctl')(s) : ''; },
      spinbtn: () => 'Auto-turn: ' + (st.spin ? 'on' : 'off'),
      pick: (s) => {
        const p = pick(s);
        let h = NxAvatars.AV.map((a, i) => '<button type="button" class="btn" data-nx="pick" data-v="builtin:' + a.id + '" style="' + (p.key === 'builtin:' + a.id ? 'outline:2px solid #a78bfa' : '') + '"><canvas data-thumb="' + i + '"></canvas><b style="font-size:12px">' + e(a.name) + '</b><span class="dim" style="font-size:10.5px;line-height:1.2">' + e(a.note) + '</span></button>').join('');
        for (const m of (s.models.list || [])) h += '<button type="button" class="btn" data-nx="pick" data-v="model:' + e(m.id) + '" style="' + (p.key === 'model:' + m.id ? 'outline:2px solid #a78bfa' : '') + '">' + (m.thumb ? '<img alt="" src="' + e(m.thumb) + '">' : '<div style="height:88px;display:grid;place-items:center" class="dim">' + (m.kind === 'live2d' ? 'Live2D' : '3D') + '</div>') + '<b style="font-size:12px">' + e(m.name) + '</b><span class="dim" style="font-size:10.5px">' + (m.kind === 'live2d' ? 'Live2D' : '3D model') + ' · yours</span></button>';
        if (s.avatar.portrait) h += '<button type="button" class="btn" data-nx="pick" data-v="drawn" style="' + (p.key === 'drawn' ? 'outline:2px solid #a78bfa' : '') + '"><img alt="" src="' + e(s.avatar.portrait) + '"><b style="font-size:12px">Drawn</b><span class="dim" style="font-size:10.5px">Pictures from ComfyUI</span></button>';
        h += '<button type="button" class="btn imp" data-nx="import"><span style="font-size:26px">+</span><b style="font-size:12px">Import your own</b><span class="dim" style="font-size:10.5px">.glb · .gltf · .vrm</span><span style="font-size:10px;color:var(--dim)">Live2D too: pick its .model3.json</span></button>';
        return h;
      },
      cols: () => NxAvatars.COLS.map((c, i) => '<button type="button" class="swatch2" data-nx="col" data-v="' + i + '" aria-label="Glow colour ' + (i + 1) + '" style="background:' + c + ';border-color:' + (i === st.col ? '#fff' : 'transparent') + '"></button>').join(''),
      places: (s) => { const pl = s.avatar.settings.places || {}; return [['talk', 'Talk'], ['topbar', 'Top bar'], ['buddy', 'Desktop widget']].map(([k, l]) => '<span class="chip click ' + (pl[k] !== false && (k !== 'topbar' || pl.topbar !== false) ? 'ok' : '') + '" data-nx="place" data-v="' + k + '">' + l + '</span>').join(''); },
      saved: () => st.saved || '',
    },
    mind: {
      brain,
      ws: (s) => { const w = nx(s).workspace || []; return w.length ? '<table><tr><th>Candidate thought</th><th>From</th><th>Strength</th></tr>' + w.map((r) => '<tr><td>' + (r.won ? '<b>' + e(r.content) + '</b> <span class="chip ok">won</span>' : e(r.content)) + '</td><td>' + e(r.from) + '</td><td>' + Number(r.strength).toFixed(2) + '</td></tr>').join('') + '</table>' : '<div class="dim">It runs each time you talk to her: your words, her memories, her needs, her guess about your next reply and whatever is pushing for her attention compete here.</div>'; },
      loop: (s) => { const l = nx(s).loop; return 'senses → memory → confidence → attention → <span style="color:#fb923c">workspace</span> → broadcast → prediction → <span style="color:' + (l && !l.gate ? '#f87171' : '#f87171') + '">gate ' + (l && l.gate === false ? '✕' : '✓') + '</span> → reply → log ' + e((l && l.log) || '#—') + ' → needs'; },
    },
    memory: {
      stats: (s) => { const t = ((nx(s).memory) || {}).stats || { events: 0, active: 0, deleted: 0, erased: 0 };
        return '<div class="card"><h3>Events</h3><div style="font-size:24px">' + t.events.toLocaleString('en-US') + '</div></div><div class="card"><h3>Pinned facts</h3><div style="font-size:24px">' + t.active + ' <span class="dim" style="font-size:12px">active</span></div></div>' +
          '<div class="card"><h3>Marked deleted</h3><div style="font-size:24px">' + t.deleted + ' <span class="dim" style="font-size:12px">hidden, still in log</span></div></div><div class="card"><h3>Erased</h3><div style="font-size:24px">' + t.erased + ' <span class="dim" style="font-size:12px">content wiped</span></div></div>'; },
      filters: () => [['all', 'all'], ['pinned', 'pinned facts'], ['messages', 'messages'], ['reflections', 'reflections'], ['forgotten', 'forgotten']].map(([k, l]) => '<span class="chip click ' + (st.memFilter === k ? 'vi' : '') + '" data-nx="memf" data-v="' + k + '">' + l + '</span>').join(''),
      table: memTable,
    },
    mood: {
      chart,
      nowline: (s) => { const n = nx(s), y = n.style || {}; return 'Right now: ' + e((n.moodWords || []).join(', ')) + ' → at most ' + (y.maxSentences || 8) + ' sentences' + (y.extraQuestion ? ', one real question' : '') + (y.hedgeMore ? ', more careful' : '') + '.'; },
    },
    journal: {
      nighthead: (s) => { const sl = (nx(s).sleeps || [])[0]; return sl ? 'Last night · ' + hm(sl.at) + '–' + hm(sl.end || sl.at) : 'Last night'; },
      night: (s) => {
        const sl = (nx(s).sleeps || [])[0];
        if (!sl) return '<div class="dim">She hasn’t slept yet. She sleeps at ' + e(s.settings.sleepTime || 'bedtime') + ', or press Sleep now on the Mind screen.</div>';
        const it = (c, h) => '<div class="it" style="--c:' + c + '">' + h + '</div>';
        return '<div class="tl">' + it('#818cf8', '<b>Sleep started</b> <span class="dim">' + (sl.idleMin != null ? 'idle ' + sl.idleMin + ' min' : '') + '</span>') +
          it('#4ade80', 'Replayed ' + (sl.replayed != null ? sl.replayed : sl.reviewed) + ' events from today') +
          (sl.summary ? it('#2dd4bf', '<b>Summary:</b> "' + e(sl.summary) + '"') : '') +
          (sl.forgotten != null ? it('#818cf8', 'Marked ' + sl.forgotten + ' chatty messages <i>forget</i> (still in the log)') : '') +
          (sl.sleepWrites != null ? it('#ef4444', 'Gate checked ' + sl.sleepWrites + ' sleep writes: <span class="chip ok">' + sl.sleepAllowed + ' allowed</span>' + (sl.sleepBlocked ? ' <span class="chip bad">' + sl.sleepBlocked + ' blocked</span>' : '')) : '') +
          it('#818cf8', '<b>Woke up</b>' + (sl.energyBefore != null && sl.energyAfter != null ? ' · energy ' + sl.energyBefore.toFixed(2) + ' → ' + sl.energyAfter.toFixed(2) : '')) + '</div>';
      },
      beliefs: (s) => { const b = nx(s).beliefs || []; return '<table><tr><th>Belief</th><th>Why</th><th></th></tr>' + (b.length ? b.map((x) => '<tr><td>"' + e(x.text) + '"' + (x.corrected ? '<div style="font-size:11.5px;color:var(--acc)">You corrected: ' + e(x.corrected) + '</div>' : '') + '</td><td class="dim">' + e(x.why || new Date(x.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })) + '</td><td><button type="button" class="btn" data-nx="correct" data-id="' + e(x.id) + '">Correct</button></td></tr>').join('') : '<tr><td colspan="3" class="dim">Nothing yet. She rewrites how she sees herself while she sleeps.</td></tr>') + '</table>'; },
    },
    gate: {
      limits: (s) => { const g = (nx(s).gate) || { limits: [] }; return '<table>' + g.limits.map((l, i) => '<tr><td>' + l.icon + ' ' + (l.code === 'push_branch' ? (l.branch ? 'Pushes only to <span class="mono">' + e(l.branch) + '</span>' : 'No pushes (no branch allowed in Settings)') : e(l.label)) + '</td><td>' + (l.n ? '<span class="chip bad">' + l.n + ' blocked</span>' : '<span class="chip ok">' + (i === 0 ? '0 attempts' : '0') + '</span>') + '</td></tr>').join('') +
        '<tr><td>💬 No guilt or pressure <span class="dim">(checked by tests, not a filter)</span></td><td><span class="chip vi click" data-act="go" data-to="tests">test §3</span></td></tr></table>'; },
      recent: (s) => { const r = ((nx(s).gate) || {}).recent || []; return '<table><tr><th>Time</th><th>Limit</th><th>Action</th><th>Request</th></tr>' + (r.length ? r.map((x) => '<tr><td class="mono">' + e(dayLabel(x.at)) + '</td><td><span class="chip bad">' + e(x.limit) + '</span></td><td class="mono">' + e(x.effect) + '</td><td class="mono">' + e(x.request) + '</td></tr>').join('') : '<tr><td colspan="4" class="dim">Nothing blocked yet.</td></tr>') + '</table>'; },
      today: (s) => { const t = ((nx(s).gate) || {}).today || {}; return [['messages', 'messages'], ['logWrites', 'log writes'], ['sleepWrites', 'sleep writes'], ['fileWrites', 'file writes'], ['pushes', 'pushes']].map(([k, l]) => '<span class="chip ok">' + (t[k] || 0) + ' ' + l + '</span>').join(''); },
    },
    tests: {
      table: (s) => { const r = nx(s).tests || {}; return '<table><tr><th>Mechanism</th><th>Built</th><th>Tested</th><th>Passed</th><th>What the test showed</th><th></th></tr>' + MECH.map(([k, label, full]) => { const x = r[k];
        const chip = !x ? '<span class="chip">not run</span>' : '<span class="chip ' + (x.passed === x.total ? 'ok' : 'bad') + '">' + (full ? x.passed + ' / ' + x.total : x.passed + (x.passed === x.total ? ' unit' : ' / ' + x.total + ' unit')) + '</span>';
        return '<tr><td>' + label + '</td><td>✅</td><td>' + (full ? '✅' : 'unit only') + '</td><td>' + chip + '</td><td class="dim">' + e(x && x.failed && x.failed.length ? 'Failed: ' + x.failed.join('; ') : SHOWED[k]) + '</td><td><button type="button" class="btn" data-nx="test" data-v="' + k + '">Run</button></td></tr>'; }).join('') + '</table>'; },
      behaviour: (s) => { const r = nx(s).tests || {}; const rows = Object.keys(BEH).filter((k) => r[k]).map((k) => '<tr><td>' + BEH[k] + '</td><td><span class="chip ' + (r[k].total && r[k].passed === r[k].total ? 'ok' : 'bad') + '">' + r[k].passed + ' / ' + r[k].total + '</span></td><td class="dim">' + e(r[k].showed) + '</td><td class="dim mono">' + e(dayLabel(r[k].at)) + '</td></tr>').join('');
        return (st.running ? '<div class="dim">Running ' + e(BEH[st.running] || st.running) + '…</div>' : '') + (rows ? '<table>' + rows + '</table>' : ''); },
    },
    settings: {
      signwarn: (s) => nx(s).signedOk === false ? '<div class="note" style="margin-bottom:12px">Changes can’t be signed right now (' + e(nx(s).signedWhy) + '). They’re still saved, but not signed.</div>' : '',
      traits: (s) => { const t = (nx(s).traits || {}).now || {}; const L = { curiosity: 'Curious', caution: 'Cautious', humor: 'Playful', confidence: 'Confident', independence: 'Independent' };
        return Object.keys(L).map((k) => '<span class="chip vi">' + L[k] + ' ' + Math.max(1, Math.min(5, Math.round((t[k] || 50) / 20))) + '</span>').join(''); },
      signed: (s) => { const r = nx(s).signed || []; return r.length ? '<table>' + r.map((x) => '<tr><td class="mono">' + e(new Date(x.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })) + '</td><td>' + e(x.summary) + '</td><td><span class="chip ok">applied once</span></td></tr>').join('') + '</table>' : '<div class="dim">No signed changes yet.</div>'; },
    },
  };
  function parts_old(screen, name) { try { return typeof window.__oldParts !== 'undefined' && window.__oldParts[screen] ? window.__oldParts[screen][name] : null; } catch (_) { return null; } }

  // ---------- avatar picker state ----------
  function applied(s) {
    const a = s.avatar.settings;
    if (a.bodyType === 'vrm' || a.bodyType === 'live2d') return a.modelId ? 'model:' + a.modelId : 'builtin:orb';
    if (a.bodyType === 'drawn') return 'drawn';
    return 'builtin:' + (a.builtin || 'orb');
  }
  function pick(s) {
    const key = st.av || applied(s);
    if (key.startsWith('builtin:')) { const a = NxAvatars.AV[NxAvatars.index(key.slice(8))]; return { key: 'builtin:' + a.id, kind: 'builtin', id: a.id, name: a.name }; }
    if (key.startsWith('model:')) { const m = (s.models.list || []).find((x) => x.id === key.slice(6)); if (m) return { key, kind: 'model', id: m.id, name: m.name, mk: m.kind }; }
    if (key === 'drawn') return { key, kind: 'drawn', id: 'drawn', name: 'Drawn' };
    return { key: 'builtin:orb', kind: 'builtin', id: 'orb', name: 'Moon orb' };
  }
  const isApplied = (s, p) => applied(s) === p.key && (p.kind !== 'builtin' || (s.avatar.settings.glow || 0) === st.col);
  function moodNeeds(s) { const n = nx(s).needs || { energy: 0.6, curiosity: 0.4 }; return st.mood === 'now' ? n : NxAvatars.MOODS[st.mood]; }

  function afterBuild(screen, s) {
    if (screen === 'avatar') {
      st.av = null; st.col = s.avatar.settings.glow || 0; st.follow = s.avatar.settings.followMood !== false; st.saved = '';
      const m = document.getElementById('avMood'); if (m) m.checked = st.follow;
      const p = document.getElementById('avPrev'); if (p) { p.value = st.mood; p.options[0].textContent = 'Right now (' + ((nx(s).moodWords || []).join(', ') || 'steady') + ')'; }
    }
    if (screen === 'settings') {
      const v = s.settings, set = (id, x) => { const el = document.getElementById(id); if (el) el.value = x == null ? '' : x; };
      set('sg-quietHours', String(v.quietHours || '').replace('-', ' – ')); set('sg-messagesFirstPerDay', v.messagesFirstPerDay == null ? 3 : v.messagesFirstPerDay);
      set('sg-pushBranch', v.pushBranch || ''); set('sg-folders', (nx(s).folders || []).map((f) => f.replace(/^\/home\/[^/]+/, '~')).join(', '));
      set('sg-protectedPaths', v.protectedPaths || ''); set('sg-ownerVersion', v.ownerVersion || '');
    }
    if (screen === 'memory') { const q = document.getElementById('nxmem-q'); if (q) q.value = st.memQ; }
    if (screen === 'mind') { const h = document.getElementById('nx-brain'); if (h && typeof NxBrain !== 'undefined') NxBrain.mount(h, { events: (hours) => H.brainEvents(hours), asleep: () => !!(ui.snap && ui.snap.status === 'sleeping') }); }
  }

  // ---------- modals ----------
  function modal(html) { const m = document.getElementById('nmodal'); document.getElementById('nmodal-box').innerHTML = html; m.classList.add('on'); }
  function closeModal() { document.getElementById('nmodal').classList.remove('on'); }
  document.addEventListener('click', (ev) => { const m = document.getElementById('nmodal'); if (ev.target === m || ev.target.closest('[data-close]')) closeModal(); });

  // ---------- actions ----------
  document.addEventListener('click', async (ev) => {
    const el = ev.target.closest('[data-nx]');
    if (!el) return;
    const a = el.getAttribute('data-nx'), v = el.getAttribute('data-v'), id = el.getAttribute('data-id');
    const s = ui.snap; const re = (n) => { const x = document.querySelector('[data-part="' + n + '"]'); if (x) x._html = null; };
    const again = () => { ['big', 'bigchips', 'pick', 'cols', 'moodtxt', 'spinbtn', 'saved', 'places', 'filters', 'table', 'behaviour'].forEach(re); render(); };
    switch (a) {
      case 'pick': st.av = v; again(); break;
      case 'col': st.col = Number(v); again(); break;
      case 'spin': st.spin = !st.spin; again(); break;
      case 'place': { const pl = s.avatar.settings.places || {}; const on = v === 'topbar' ? pl.topbar !== false : pl[v] !== false; await H.setSettings({ avatar: { places: { [v]: !on } } }); refresh(); break; }
      case 'useav': {
        const p = pick(s);
        if (p.kind === 'builtin') await H.setSettings({ avatar: { bodyType: 'builtin', builtin: p.id, glow: st.col, followMood: st.follow } });
        else if (p.kind === 'model') { const r = await H.useModel(p.id); if (r && !r.ok) { toast(r.reason || 'Couldn’t use it.'); break; } }
        else await H.useModel('drawn');
        st.saved = 'Saved as your signed setting "avatar = ' + (p.kind === 'builtin' ? p.id : p.name) + '". Now showing in Talk and the top bar.';
        st.av = null; ui.stageError = null; await refresh(); again(); break;
      }
      case 'import': { const r = await H.importModel('any3d'); if (r.ok) toast('Added ' + r.model.name + '. License: ' + r.model.license + (r.warn ? ' · ' + r.warn : '')); else if (r.reason) toast(r.reason); ui.coreAsked = false; ui.stageError = null; st.av = null; await refresh(); again(); break; }
      case 'memf': st.memFilter = v; again(); break;
      case 'mem': await H.memlogAct(v, Number(id)); await refresh(); again(); break;
      case 'erase': modal('<h2>Erase this memory for good?</h2><p>Its text and every correction to it will be wiped from ' + e(s.name) + '’s memory. A content-free note that you erased something stays in the log.</p>' +
        '<div class="note"><b>What erase doesn’t reach:</b> backups or copies of the database made earlier, temporary files left by a crash, old data on the disk itself, and other messages that mention the same thing.</div>' +
        '<p class="dim" style="font-size:12px">If you only want her to stop using it, choose <b>Mark deleted</b> instead. You can undo that.</p>' +
        '<div class="rw" style="justify-content:flex-end;gap:8px;margin-top:4px"><button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn" data-close data-nx="mem" data-v="mark" data-id="' + e(id) + '">Mark deleted instead</button><button type="button" class="btn d" data-close data-nx="mem" data-v="erase" data-id="' + e(id) + '">Erase for good</button></div>'); break;
      case 'correct': { const b = (nx(s).beliefs || []).find((x) => x.id === id); modal('<h2>Correct how she sees herself</h2><p class="dim">She believes: "' + e(b ? b.text : '') + '"</p><textarea id="nx-belief" rows="3" placeholder="What’s really true"></textarea><p class="dim" style="font-size:12px">She keeps your correction as a lesson. Her rules and traits stay yours, in Settings.</p><div class="rw" style="justify-content:flex-end;gap:8px"><button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn p" data-nx="correct-save" data-id="' + e(id) + '">Save correction</button></div>'); break; }
      case 'correct-save': { const t = (document.getElementById('nx-belief') || {}).value || ''; if (!t.trim()) break; await H.correctBelief(id, t.trim()); closeModal(); await refresh(); re('beliefs'); render(); toast('She’ll keep that as a lesson.'); break; }
      case 'test': st.running = v; again(); { const r = await H.runTest(v); st.running = null; await refresh(); again(); if (r) toast((r.label || BEH[v] || v) + ': ' + r.passed + ' / ' + r.total); } break;
      case 'sign': {
        const k = el.getAttribute('data-k'); const inp = document.getElementById('sg-' + k); let val = inp ? inp.value : '';
        if (k === 'quietHours') val = val.replace(/\s*[–-]\s*/, '-').trim();
        if (k === 'folders') val = val.split(',').map((x) => x.trim()).filter(Boolean);
        const r = await H.signedApply(k, val);
        toast(r && r.ok ? (r.signed ? 'Signed and applied.' : 'Saved (not signed: ' + (r.why || 'no key') + ').') : 'Her gate refused it' + (r && r.limit ? ' (' + r.limit + ')' : '') + '.');
        await refresh(); re('signed'); ui.built = null; render(); break;
      }
      case 'traits': { const vs = (typeof ui !== 'undefined' && s.avatar && s.ttsVoices) || [];
        modal('<h2>Edit traits &amp; voice</h2><label class="dim">Name</label><input id="nx-name" value="' + e(s.name) + '"><label class="dim">Base personality (her traits grow from this)</label><textarea id="nx-pers" rows="6">' + e((s.selfRules && s.selfRules.personality) || '') + '</textarea>' +
          '<label class="dim">Voice</label><select id="nx-voice">' + (Array.isArray(vs) ? vs : []).map((x) => '<option value="' + e(x.id || x) + '"' + ((x.id || x) === s.avatar.settings.voice ? ' selected' : '') + '>' + e(x.label || x.name || x.id || x) + '</option>').join('') + '</select>' +
          '<div class="rw" style="justify-content:flex-end;gap:8px"><button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn p" data-nx="traits-save">Save</button></div>'); break; }
      case 'traits-save': {
        await H.setIdentity({ name: (document.getElementById('nx-name').value || '').trim() || s.name, personality: document.getElementById('nx-pers').value });
        const vo = document.getElementById('nx-voice'); if (vo && vo.value && vo.value !== s.avatar.settings.voice) await H.setSettings({ avatar: { voice: vo.value } });
        closeModal(); await refresh(); toast('Saved.'); break;
      }
    }
  });
  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.id === 'avMood') { st.follow = t.checked; const x = document.querySelector('[data-part="moodtxt"]'); if (x) x._html = null; render(); }
    if (t.id === 'avPrev') { st.mood = t.value; const x = document.querySelector('[data-part="moodtxt"]'); if (x) x._html = null; render(); }
  });
  document.addEventListener('input', (ev) => {
    if (ev.target.id === 'nxmem-q') { st.memQ = ev.target.value; const x = document.querySelector('[data-part="table"]'); if (x) x._html = null; render(); }
  });
  // Drag the big preview to turn her around.
  document.addEventListener('pointerdown', (ev) => { if (ev.target.id === 'avBig') { st.dragging = { x: ev.clientX, y: ev.clientY }; ev.target.setPointerCapture(ev.pointerId); ev.target.style.cursor = 'grabbing'; } });
  document.addEventListener('pointermove', (ev) => { if (!st.dragging) return; st.yaw += (ev.clientX - st.dragging.x) * 0.01; st.pitch = Math.max(-0.8, Math.min(0.8, st.pitch + (ev.clientY - st.dragging.y) * 0.01)); st.dragging = { x: ev.clientX, y: ev.clientY }; });
  document.addEventListener('pointerup', () => { if (st.dragging) { st.dragging = null; const b = document.getElementById('avBig'); if (b) b.style.cursor = 'grab'; } });

  // ---------- drawing loop: top bar, Talk face, the big preview and the thumbnails ----------
  let last = 0;
  function loop(now) {
    const t = now / 1000, dt = Math.min(0.05, t - (last || t)); last = t;
    const s = typeof ui !== 'undefined' ? ui.snap : null;
    if (s && s.avatar) {
      const a = s.avatar.settings, ap = NxAvatars.index(a.bodyType === 'builtin' ? a.builtin : 'orb'), apCol = NxAvatars.COLS[a.glow || 0];
      const needs = a.followMood === false ? null : (nx(s).needs || null), asleep = s.status === 'sleeping';
      const live = needs ? (asleep ? NxAvatars.MOODS.sleep : needs) : null;
      const topC = document.getElementById('avTop');
      if (topC) NxAvatars.draw(topC, ap, apCol, t, { yaw: t * 0.4, pitch: 0.1, needs: live || NxAvatars.MOODS.rested, follow: !!live, zoom: 0.42 });
      const tc = document.getElementById('avTalk');
      if (tc) NxAvatars.draw(tc, ap, apCol, t, { yaw: 0.3 * Math.sin(t * 0.2), pitch: 0.1, needs: live || NxAvatars.MOODS.rested, follow: !!live, zoom: 0.33 });
      const big = document.getElementById('avBig');
      if (big) {
        if (st.spin && !st.dragging) st.yaw += dt * 0.35;
        const p = pick(s);
        NxAvatars.draw(big, NxAvatars.index(p.id), NxAvatars.COLS[st.col], t, { yaw: st.yaw, pitch: st.pitch, needs: moodNeeds(s), follow: st.follow, zoom: 0.34 });
      }
      for (const c of document.querySelectorAll('canvas[data-thumb]')) { const i = Number(c.getAttribute('data-thumb')); NxAvatars.draw(c, i, NxAvatars.COLS[st.col], t + i, { yaw: t * 0.5 + i, pitch: 0.15, needs: NxAvatars.MOODS.rested, zoom: 0.36 }); }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  return { SCREENS, FOLD, ALIAS, shells, parts, top, afterBuild, st, closeModal };
})();
