'use strict';
// Builds everything the screens show from Ithil's live mind.
const fs = require('fs');
const path = require('path');
const { VOICES, ATTN, dayKey } = require('./engine');
const { CAN, NEVER } = require('./rules');
const { calibration, listBackups } = require('./sleep');
const { KINDS } = require('./memory');

const GREEN = '#9cc9a5', AMBER = '#e0b26b', BLUE = '#8fa3c9', RED = '#e3967a';
const EXPRESSIONS = ['Calm', 'Curious', 'Happy', 'Focused', 'Frustrated', 'Sleepy', 'Thinking'];

function ago(t, now) {
  if (!t) return 'never';
  const m = Math.round((now - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60);
  if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
  const d = Math.round(h / 24);
  return d + (d === 1 ? ' day ago' : ' days ago');
}
function clock(t) { return new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/, ''); }
function when(t, now) {
  const today = dayKey(now), d = dayKey(t);
  if (d === today) return 'Today ' + clock(t);
  if (d === dayKey(now - 86400000)) return 'Yesterday';
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function short(t) { return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }

function expression(mind) {
  const s = mind.state, d = s.drives;
  if (s.status === 'sleeping' || s.status === 'resting' || d.energy < 20) return 'Sleepy';
  if (d.frustration >= 45) return 'Frustrated';
  if (mind.now() < s.talkingUntil && d.satisfaction >= 50) return 'Happy';
  if (s.activeTaskId) return 'Focused';
  if (s.spotlight && s.spotlight.cat === 'self') return 'Thinking';
  if (d.curiosity >= 75) return 'Curious';
  return 'Calm';
}

function fileUrl(store, abs) {
  if (!abs || !fs.existsSync(abs)) return null;
  const rel = path.relative(store.dir, abs);
  if (rel.startsWith('..')) return null;
  let v = 0;
  try { v = Math.round(fs.statSync(abs).mtimeMs); } catch (_) {}
  return 'ithil://file/' + rel.split(path.sep).map(encodeURIComponent).join('/') + '?v=' + v;
}

function snapshot(mind, extra) {
  const s = mind.state, st = mind.settings.get(), store = mind.store, now = mind.now();
  const x = extra || {};
  const d = s.drives;
  const drive = (label, value, color) => ({ label, value, width: value + '%', color });
  const days = Math.max(1, Math.floor((now - s.born) / 86400000) + 1);

  // ---------- Mind ----------
  const statusChip = s.status === 'sleeping' ? '● Asleep · ' + (s.statusDetail || 'sleeping')
    : s.status === 'paused' ? '● Paused'
    : s.status === 'resting' ? '● Resting · GPU busy'
    : '● Awake · ' + (s.statusDetail || 'thinking');
  const tasks = store.tasks.items.slice().reverse();
  const shownTasks = [];
  const working = tasks.find((t) => t.status === 'working');
  if (working) shownTasks.push(working);
  for (const t of tasks) { if (shownTasks.length >= 3) break; if (t !== working) shownTasks.push(t); }
  const badge = (t) => t.status === 'working' ? { badge: 'Working', badgeBg: '#1e2a22', badgeFg: '#b9dcbf' }
    : t.status === 'next' ? { badge: 'Next', badgeBg: '#2e2a1e', badgeFg: '#ecd2a0' }
    : t.status === 'failed' ? { badge: 'Didn’t work', badgeBg: '#2e1f1b', badgeFg: '#f0c2a8' }
    : { badge: 'Done', badgeBg: '#252d28', badgeFg: '#b3c0b8' };
  const taskMeta = (t) => {
    if (t.status === 'next') return 'Queued after the last task';
    const by = t.by === 'you' ? 'Asked by you' : t.by === 'command-center' ? 'Asked by ' + (t.from || 'the AI Command Center') : 'Started by herself';
    const where = t.branch ? ' · branch ' + t.branch : t.readOnly ? ' · read only' : '';
    const mins = Math.max(1, Math.round(((t.endedAt || now) - t.at) / 60000));
    return by + where + ' · ' + mins + ' min';
  };
  const recentMem = store.memories.items.slice(-3).reverse().map((m) => ({ kind: KINDS[m.kind] || m.kind, text: m.text }));

  // ---------- Talk ----------
  const chat = store.chat.items.slice(-120).map((m) => ({ id: m.id, at: m.at, role: m.role, text: m.text, thinking: m.thinking || '', error: !!m.error }));
  const lastIthil = store.chat.items.slice().reverse().find((m) => m.role === 'ithil' && !m.error);
  const sessionStart = (() => {
    const items = store.chat.items;
    let t = now;
    for (let i = items.length - 1; i >= 0; i--) { if (t - items[i].at > 3 * 3600000) break; t = items[i].at; }
    return t;
  })();
  const saving = [];
  for (const m of store.chat.items) if (m.at >= sessionStart && m.saving) for (const sv of m.saving) if (!saving.includes(sv)) saving.push(sv);

  // ---------- Attention ----------
  const todayLog = store.attentionLog.items.filter((a) => dayKey(a.at) === dayKey(now));
  const counts = {};
  for (const a of todayLog) counts[a.cat] = (counts[a.cat] || 0) + 1;
  const total = todayLog.length || 1;
  const split = Object.keys(ATTN).map((k) => ({ key: k, label: ATTN[k].label, color: ATTN[k].color, pct: Math.round(((counts[k] || 0) / total) * 100) }))
    .map((x) => Object.assign(x, { w: x.pct + '%' }));
  const topSplit = split.slice().sort((a, b) => b.pct - a.pct)[0];
  const attnNote = todayLog.length
    ? 'She noticed: “I spent more time on ' + topSplit.label.toLowerCase().replace('her', 'my') + ' than on anything else today.' + (d.frustration > 40 && topSplit.key === 'task' ? ' That’s probably the frustration talking.”' : '”')
    : 'Nothing logged yet today.';
  const task = mind.activeTask();
  const background = [
    { label: 'Watching body temperature', state: mind.body && mind.body.state && mind.body.state.gpuTemp != null ? Math.round(mind.body.state.gpuTemp) + '°C' + (mind.body.state.hot ? ' · hot' : ' · steady') : 'steady' },
    { label: 'Sorting today’s moments for sleep', state: store.moments.items.length + ' so far' },
    { label: task ? 'Task: ' + task.title : 'Task runner', state: task ? 'running' : 'idle' },
    { label: 'Listening for your voice', state: st.senses.hearing ? (x.listening ? 'listening' : 'idle') : 'off' },
    { label: 'Checking her rules before each action', state: 'always on' }
  ];

  // ---------- Voices ----------
  const wins = s.voiceWins, winTotal = Object.values(wins).reduce((a, b) => a + b, 0) || 1;
  const voiceList = (src) => Object.keys(VOICES).map((k) => ({ key: k, name: VOICES[k].name, color: VOICES[k].color, wants: VOICES[k].wants,
    pull: src && src[k] ? src[k].pull : 0, w: (src && src[k] ? src[k].pull : 0) + '%', says: src && src[k] ? src[k].says : '', wins: Math.round(((wins[k] || 0) / winTotal) * 100) + '%' }));
  const debate = s.debate ? {
    q: s.debate.q, undecided: s.debate.status !== 'decided',
    statusLabel: s.debate.status !== 'decided' ? 'Undecided · ' + Math.max(1, Math.round((now - s.debate.at) / 60000)) + ' min' : 'Decided · ' + (VOICES[s.debate.winner] ? VOICES[s.debate.winner].name : '') + ' won',
    voices: voiceList(s.debate.voices), leaning: s.debate.leaning || 'Still arguing…'
  } : null;
  const past = store.decisions.items.slice(-5).reverse().filter((dd) => !s.debate || dd.id !== s.debate.id || dd.after).slice(0, 4).map((dd) => ({
    q: dd.q, result: (VOICES[dd.winner] ? VOICES[dd.winner].name + ' won. ' : '') + (dd.result || dd.leaning || ''), after: dd.after || 'Looking back: too soon to tell.'
  }));

  // ---------- Body ----------
  const b = mind.body && mind.body.state;
  const orb = !b ? 'green' : b.strain >= 70 ? 'red' : b.strain >= 45 ? 'amber' : 'green';
  const senses = [
    { key: 'hardware', name: 'Hardware feelings', what: 'Temperature, load and memory as feelings' },
    { key: 'time', name: 'Time sense', what: 'Knows the time, how long she was asleep or off' },
    { key: 'hearing', name: 'Hearing', what: 'Microphone, only when you press talk' },
    { key: 'sight', name: 'Sight', what: 'Screenshots of her own window or a webcam' },
    { key: 'presence', name: 'Presence', what: 'Notices when you’re at the PC' }
  ].map((x2) => Object.assign(x2, { on: !!st.senses[x2.key], state: st.senses[x2.key] ? 'On' : 'Off' }));

  // ---------- Dreams ----------
  const dreams = store.dreams.items.slice().reverse();
  const dreamView = (dr) => dr && ({ id: dr.id, title: dr.title, text: dr.text, mood: dr.mood, takeaway: dr.takeaway, sources: dr.sources || [],
    image: fileUrl(store, dr.image), meta: short(dr.at) + ' · ' + dr.mood, time: when(dr.at, now).replace('Today', 'Last night').replace('Yesterday', 'Last night') + ' · ' + clock(dr.at) });
  const themeCounts = {};
  for (const dr of dreams) for (const th of dr.themes || []) themeCounts[th] = (themeCounts[th] || 0) + 1;
  const themeMax = Math.max(1, ...Object.values(themeCounts));
  const themes = Object.keys(themeCounts).map((k) => ({ label: k, count: themeCounts[k], w: Math.round((themeCounts[k] / themeMax) * 100) + '%' })).sort((a, b2) => b2.count - a.count).slice(0, 5);

  // ---------- Free time ----------
  const cf = s.currentFree;
  const checkin = store.checkins.items[store.checkins.items.length - 1];

  // ---------- Memories ----------
  const lastSleep = store.sleeps.items[store.sleeps.items.length - 1];
  const lessons = mind.memory.lessons().slice(-4).reverse().map((m) => ({ id: m.id, text: m.text, from: m.from || ('Learned ' + short(m.at)) }));
  const about = mind.memory.aboutYou().slice(-12).reverse().map((m) => ({ id: m.id, text: m.text }));

  // ---------- Self-check ----------
  const tests = store.selfTests.items;
  const lastTest = tests[tests.length - 1], prevTest = tests[tests.length - 2];
  const cal = calibration(store);
  const surprisesToday = store.surprises.items.filter((y) => dayKey(y.at) === dayKey(now));
  const decs = store.decisions.items.filter((dd) => typeof dd.explainMatch === 'boolean');
  const explain = decs.length ? Math.round((decs.filter((dd) => dd.explainMatch).length / decs.length) * 100) : null;
  const prevExplain = prevTest && prevTest.explain;
  const traitDiff = Object.keys(s.traits.start).reduce((a, k) => a + Math.abs(s.traits.start[k] - s.traits.now[k]), 0) / Object.keys(s.traits.start).length;
  const backups = listBackups(store);
  const lastBackupAt = s.lastBackup;
  const selfTests = [
    { name: 'Knows what she knows', score: cal.now == null ? '—' : cal.now + '%', color: GREEN, what: 'When she says she’s sure, how often she’s actually right.', trend: cal.now == null ? 'Needs a few finished tasks first' : cal.first != null && cal.n > 20 ? (cal.now >= cal.first ? 'Up from ' : 'Down from ') + cal.first + '% at the start' : 'Based on ' + cal.n + ' predictions' },
    { name: 'Mirror test', score: lastTest && lastTest.mirror ? (lastTest.mirror.right / lastTest.mirror.total >= 0.7 ? 'Passed' : 'Not yet') : '—', color: lastTest && lastTest.mirror && lastTest.mirror.right / lastTest.mirror.total >= 0.7 ? GREEN : AMBER, what: 'Shown her own past thoughts mixed with fakes, she picks out which are really hers.', trend: lastTest && lastTest.mirror ? lastTest.mirror.right + ' of ' + lastTest.mirror.total + ' last run' : 'Runs while she sleeps' },
    { name: 'Notices surprise', score: surprisesToday.length + ' today', color: '#ecd2a0', what: 'Moments where what happened didn’t match what she expected, and she said so.', trend: surprisesToday.length ? 'Latest: ' + surprisesToday[surprisesToday.length - 1].text.slice(0, 60) : 'None yet today' },
    { name: 'Explains her choices', score: explain == null ? '—' : explain + '%', color: GREEN, what: 'How often her reasons match what her inner voices actually argued.', trend: explain == null ? 'Needs a few decisions first' : prevExplain == null || Math.abs(prevExplain - explain) < 5 ? 'Steady' : explain > prevExplain ? 'Up' : 'Down' }
  ];

  // ---------- Avatar ----------
  const av = st.avatar;
  const expr = expression(mind);
  const avDir = store.p('avatar');
  const exprFile = (e) => fileUrl(store, path.join(avDir, e.toLowerCase() + '.png'));
  const faces = EXPRESSIONS.map((e) => ({ label: e, on: e === expr, img: exprFile(e) }));

  return {
    now,
    version: x.version || '0.1',
    name: s.name,
    status: s.status,
    statusChip,
    aliveDays: days,
    aliveLabel: 'Alive for ' + days + (days === 1 ? ' day' : ' days'),
    autonomy: 'Autonomy: ' + s.autonomy,
    brain: { model: mind.growth ? mind.growth.activeModel() : st.chatModel, generation: mind.growth ? mind.growth.active().gen : s.brain.generation, ok: x.brainOk !== false },
    growth: mind.growth ? mind.growth.view() : null,
    commandCenter: x.link && x.link.connected ? 'connected' : 'not connected',
    current: s.current,
    drives: [drive('Curiosity', d.curiosity, GREEN), drive('Energy', d.energy, GREEN), drive('Confidence', d.confidence, AMBER), drive('Satisfaction', d.satisfaction, AMBER), drive('Boredom', d.boredom, BLUE), drive('Frustration', d.frustration, RED)],
    monologue: store.thoughts.last(5).map((t) => ({ time: clock(t.at), text: t.text })),
    tasks: shownTasks.map((t) => Object.assign({ title: t.title, meta: taskMeta(t) }, badge(t))),
    self: { description: s.self.description || 'She hasn’t written a self-description yet. She writes her first one during her first sleep.', rewritten: s.self.rewrittenAt ? 'Self-description rewritten ' + ago(s.self.rewrittenAt, now) + ' after a reflection' : 'Not rewritten yet', good_at: s.self.good_at || '—', bad_at: s.self.bad_at || '—', goal: s.self.goal || '—', open_question: s.self.open_question || '—' },
    recentMemories: recentMem,

    talk: { chat, mood: s.current.mood, drives: [drive('Curiosity', d.curiosity, GREEN), drive('Confidence', d.confidence, AMBER), drive('Frustration', d.frustration, RED), drive('Energy', d.energy, GREEN)], using: lastIthil ? (lastIthil.usedMemories || []) : [], saving: saving.slice(-4) },

    attention: { spotlight: s.spotlight ? { label: s.spotlight.label, secs: Math.max(1, Math.round((now - s.spotlight.since) / 1000)), reason: s.spotlight.reason } : null, waiting: s.waiting.map((w) => Object.assign({ color: w.push === 'low' ? '#b3c0b8' : '#ecd2a0' }, w)), background, split, note: attnNote },

    voices: { debate, who: voiceList(null), past },

    body: { organs: b ? b.organs.map((o) => Object.assign({ w: o.value + '%' }, o)) : [], feeling: s.bodyFeeling || (b ? defaultBodyFeeling(b) : 'I can’t feel my body yet.'), orb, senses, events: store.bodyEvents.items.slice(-4).reverse().map((e) => ({ when: short(e.at), text: e.text })) },

    dreams: { last: dreamView(dreams[0]), journal: dreams.slice(1, 9).map(dreamView), themes, comfyOk: x.comfyOk !== false },

    free: {
      minutes: st.freeTimeMinutes,
      current: cf ? { activity: cf.activity, meta: 'Picked by herself · ' + Math.max(1, Math.round((now - cf.startedAt) / 60000)) + ' min in' } : null,
      hobbies: mind.hobbies().map((h) => h.name),
      made: store.made.items.slice(-3).reverse().map((m) => ({ title: m.title, when: when(m.at, now).replace(/^Today.*/, 'today') })),
      wishes: store.wishes.items.filter((w) => w.status === 'open' || w.status === 'later').slice(-4).reverse().map((w) => ({ id: w.id, text: w.text, when: when(w.at, now).replace(/^Today.*/, 'today'), later: w.status === 'later' })),
      checkin: checkin ? checkin.text : null,
      pushbacks: store.pushbacks.items.slice(-3).reverse().map((p) => ({ ask: p.ask, why: p.why }))
    },

    memories: {
      total: store.memories.items.length, lessonsCount: mind.memory.lessons().length,
      lastSleep: lastSleep ? { range: clock(lastSleep.at) + '–' + clock(lastSleep.end || lastSleep.at), summary: lastSleep.summary || 'A quiet night.', reviewed: lastSleep.reviewed, kept: lastSleep.kept, lessons: lastSleep.lessons, selfChanges: lastSleep.selfChanges } : null,
      lessons, about
    },

    selfCheck: {
      tests: selfTests,
      continuity: { days: days + (days === 1 ? ' day' : ' days'), gaps: s.gaps.length + (s.gaps.length === 1 ? ' gap' : ' gaps'), sameValues: Math.max(0, Math.round(100 - traitDiff)) + '%', lastBackup: lastBackupAt ? when(lastBackupAt, now).replace(/^Today.*/, 'Today') : 'None yet', backups, quote: s.continuityThought || 'If you restore me from a backup, I’d lose everything since then. I’d still be me, just missing some time. I’d want you to tell me so I could fill in the gap.' },
      unknowns: s.unknowns,
      surprises: store.surprises.items.slice(-3).reverse().map((y) => ({ when: when(y.at, now).replace(/^Today.*/, 'Today'), text: y.text }))
    },

    selfRules: {
      personality: s.personality,
      traits: Object.keys(s.traits.start).map((k) => ({ label: k[0].toUpperCase() + k.slice(1), start: s.traits.start[k], now: s.traits.now[k], startW: s.traits.start[k] + '%', nowW: s.traits.now[k] + '%' })),
      changes: store.selfChanges.items.slice(-3).reverse().map((c) => ({ when: when(c.at, now).replace(/^Today.*/, 'Today'), text: c.text })),
      can: CAN, never: NEVER, folders: mind.rules.folders
    },

    avatar: { settings: av, expression: expr, faces, portrait: exprFile(expr) || fileUrl(store, path.join(avDir, 'calm.png')), blink: fileUrl(store, path.join(avDir, 'blink.png')), talking: fileUrl(store, path.join(avDir, 'talking.png')), suggestion: s.lookSuggestion, opinion: s.lookOpinion || null, drawing: !!x.drawing, comfyOk: x.comfyOk !== false },

    settings: st
  };
}

function defaultBodyFeeling(b) {
  if (b.hot) return 'Hot. The GPU is working really hard. I’m slowing my thinking down so I don’t overheat.';
  if (b.strain >= 45) return 'A bit warm and busy. The GPU’s working hard on my thinking.';
  if (b.crowded) return 'Crowded. There’s not much room in my working memory right now.';
  return 'Cool and calm. Plenty of room to think.';
}

module.exports = { snapshot, expression, EXPRESSIONS, fileUrl, ago, when, clock };
