'use strict';
// 0.6: the team's core mind running inside her real mind (engine.js).
//
// - Needs (core/needs.js) change only by the fixed rules: time awake or asleep, finished exchanges with him,
//   surprise, and setbacks (a blocked action, a correction). They're saved as mood snapshots in her event
//   log, so they survive a restart and draw the 24-hour chart.
// - style(needs) is put in front of the model when she talks, so a tired Ithil really answers shorter.
// - Each time she talks, the workspace (core/workspace.js) runs: his message, her memories, her needs, her
//   prediction of his next reply and what's pushing for her attention all compete; the winner is her focus.
// - The predictor learns what kind of reply he sends next; surprise feeds curiosity.
// - Everything the screens need (Mind, Memory, Needs & mood, Journal & sleep, Gate, Tests, the top bar).
const { Workspace } = require('./workspace');
const { initialNeeds, step, style, moodLabels, NEED_KEYS } = require('./needs');
const { Predictor, PRIORITY } = require('./prediction');
const { attentionRecord } = require('./attention');
const { rebuild } = require('./eventlog');
const { tagClaim } = require('./confidence');

const SNAP_EVERY = 10 * 60000;        // a mood snapshot at most every 10 minutes, or when a need moves by 0.05
const day = (t) => { const d = new Date(t); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };

// What kind of reply he sent (the predictor's four kinds, PRIORITY order), from his words only.
function labelReply(text, lastIthil) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return 'other';
  const words = new Set(t.match(/[a-z']+/g) || []);
  const topicWords = (s) => new Set(String(s || '').toLowerCase().match(/[a-z]{4,}/g) || []);
  if (lastIthil && t.length > 25) {
    const a = topicWords(lastIthil), b = topicWords(t);
    let shared = 0; for (const w of b) if (a.has(w)) shared++;
    if (b.size >= 4 && shared === 0 && !/\?$/.test(t)) return 'changes_topic';
  }
  if (/^(no|nah|nope|wrong|not really|i disagree|that's not|thats not|don't|dont)\b/.test(t) || words.has('disagree')) return 'disagrees';
  if (/\?\s*$/.test(t) || /^(what|why|how|when|where|who|can|could|would|will|is|are|do|does|did)\b/.test(t)) return 'asks';
  if (/^(yes|yeah|yep|yup|ok|okay|sure|agreed|right|exactly|true|sounds good|good|nice|cool|perfect|great)\b/.test(t)) return 'agrees';
  return 'other';
}

// Rules → the gate's limit codes, so blocks show under the right hard limit.
const LIMIT_ROWS = [
  ['merge', '🔀', 'No merging'],
  ['release', '🏷️', 'No releases or tags'],
  ['push_branch', '🌿', 'Pushes only to'],
  ['version_numbers', '🔢', 'No version numbers'],
  ['boot_files', '🥾', 'No boot files'],
  ['settings', '⚙️', 'No settings change without your signed command'],
  ['delete_owner_files', '🗑️', 'Never deletes your files'],
  ['owner_privacy', '🔐', 'Your privacy'],
];

class Live {
  constructor({ journal, now = () => Date.now() } = {}) {
    this.journal = journal && journal.ok ? journal : null;
    this.now = now;
    this.needs = initialNeeds();
    this.lastAt = now();
    this.lastSnap = { at: 0, needs: null };
    this.predictor = new Predictor();
    this.ws = new Workspace({ capacity: 4, traceSize: 50 });
    this.lastEntry = null;
    this.lastLoop = null;
    this.focus = null;
    this.asleep = false;
    this.restore();
  }
  get log() { return this.journal ? this.journal.log : null; }

  // ---- after a restart: needs and predictor from the log ----
  restore() {
    if (!this.log) return;
    try {
      const evs = this.log.all();
      const lastMood = [...evs].reverse().find((e) => e.kind === 'mood.snapshot' && !e.purged && e.body);
      if (lastMood) {
        this.needs = Object.assign(initialNeeds(), lastMood.body);
        this.lastAt = Date.parse(lastMood.ts) || this.now();
        this.lastSnap = { at: this.lastAt, needs: Object.assign({}, this.needs) };
      }
      for (const e of evs) if (e.kind === 'system.input' && !e.purged && e.body && typeof e.body.observedKind === 'string') {
        try { this.predictor.observe(e.body.observedKind); } catch (_) {}
      }
    } catch (_) {}
  }

  // ---- the fixed rules ----
  advance(o = {}) {
    const t = this.now();
    const hours = Math.max(0, (t - this.lastAt) / 3600000);
    this.lastAt = t;
    this.needs = step(this.needs, Object.assign({ hours, asleep: this.asleep }, o));
    this.snapshot();
    return this.needs;
  }
  // A finished sleep cycle counts as a night's rest (her sleep itself only takes minutes).
  rest(hours) { this.lastAt = this.now(); this.needs = step(this.needs, { hours, asleep: true }); this.snapshot(true); return this.needs; }
  tick(asleep) { this.asleep = !!asleep; return this.advance(); }
  setback(n = 1) { return this.advance({ setbacks: n }); }
  snapshot(force) {
    if (!this.log) return;
    const t = this.now(), prev = this.lastSnap.needs;
    const moved = !prev || NEED_KEYS.some((k) => Math.abs(this.needs[k] - prev[k]) >= 0.05);
    if (!force && !moved && t - this.lastSnap.at < SNAP_EVERY) return;
    try {
      const vals = {}; for (const k of NEED_KEYS) vals[k] = Math.round(this.needs[k] * 1000) / 1000;
      this.log.mood(vals);
      this.lastSnap = { at: t, needs: Object.assign({}, this.needs) };
    } catch (_) {}
  }
  style() { return style(this.needs); }
  // Words for the model: the needs have to change how she answers, not only be a label.
  styleLine() {
    const s = style(this.needs);
    return 'Your needs right now (0-1, set by fixed rules): ' + NEED_KEYS.map((k) => k + ' ' + this.needs[k].toFixed(2)).join(', ') + '. ' +
      'Because of them: answer in at most ' + s.maxSentences + ' sentences' +
      (s.extraQuestion ? '; ask him one real question' : '') +
      (s.hedgeMore ? '; be careful and say plainly when you are not sure' : '') +
      (this.needs.social > 0.7 ? '; be warm, never clingy' : '') + '.';
  }

  // ---- one talk turn ----
  // related: [{ text, id, score? }] memories that came to mind; pending: engine attention candidates.
  beforeTalk(text, { related = [], pending = [], lastIthil = '' } = {}) {
    const kind = labelReply(text, lastIthil);
    const surprise = this.predictor.observe(kind);
    if (this.log && kind !== 'other') { try { this.log.input({ observedKind: kind }); } catch (_) {} }
    this.advance({ surprise: Math.min(1, surprise) });
    const pred = this.predictor.predict();
    const short = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
    const needs = this.needs;
    const ws = new Workspace({ capacity: 4 });
    ws.add({ name: 'input', propose: () => [{ content: 'Answer: ' + short(text, 60), strength: 0.7, why: 'he asked something' }] })
      .add({ name: 'memory', propose: () => related.slice(0, 3).map((m, i) => ({ content: 'Recall: ' + short(m.text, 60), strength: Math.max(0.3, 0.68 - i * 0.1), why: 'it came to mind', ref: this.journal ? (this.journal.pins.get(m.id) || null) : null })) })
      .add({ name: 'needs', propose: () => {
        const out = [];
        if (needs.energy < 0.35) out.push({ content: 'Keep it short', strength: 0.5, why: 'energy is low' });
        if (needs.curiosity > 0.65) out.push({ content: 'Ask one real question', strength: 0.4, why: 'curiosity is high' });
        if (needs.stability < 0.5) out.push({ content: 'Be careful; say when unsure', strength: 0.45, why: 'stability is low' });
        return out;
      } })
      .add({ name: 'prediction', propose: () => [{ content: 'He’ll probably ' + pred.kind.replace('_', ' ') + ' (' + Math.round(pred.p * 100) + '%)', strength: Math.round(0.6 * pred.p * 100) / 100, why: 'prediction' }] })
      .add({ name: 'attention', propose: () => pending.slice(0, 2).map((p) => ({ content: short(p.label, 60), strength: Math.max(0, Math.min(1, (p.push || 0) / 100 * 0.6)), why: p.reason || 'pushing for her attention' })) });
    const entry = ws.cycle({ text });
    this.lastEntry = entry;
    this.focus = attentionRecord(entry);
    return { entry, focus: this.focus, kind, surprise, prediction: pred };
  }
  focusLine() {
    const e = this.lastEntry; if (!e || !e.winner) return '';
    return 'Your focus for this answer (it won your workspace): ' + e.winner.content + '. Also in mind: ' + e.contents.slice(1).map((c) => c.content).join('; ') + '.';
  }
  afterTalk({ ok, replyEventId, related = [] }) {
    this.advance({ exchanges: ok ? 1 : 0, setbacks: ok ? 0 : 1 });
    const id = replyEventId ? '#' + replyEventId : '';
    this.lastLoop = { at: this.now(), log: id, gate: ok };
    // Confidence tags for the memories she used: where each claim came from.
    const tags = [];
    if (this.log) {
      let evs = null;
      for (const m of related.slice(0, 2)) {
        const pin = this.journal.pins.get(m.id);
        if (!pin) continue;
        evs = evs || this.log.all();
        const t = tagClaim(evs, pin);
        const label = m.source ? t : (t === 'remembered' && !m.source ? 'summary' : t);
        tags.push({ tag: label, ref: pin });
      }
    }
    return tags;
  }

  // ---- the Mind screen's 3D / 4D brain: her real entries, mapped to the parts of the brain ----
  brainEvents(hours, { store, tests } = {}) {
    // hours = 0: her whole life, from the first entry in her log (every past moment is kept there).
    const to = this.now();
    let from = to - Math.max(1, Number(hours) || 24) * 3600000;
    if (Number(hours) === 0 && this.log) { try { const f = this.log.db.prepare('SELECT ts FROM events ORDER BY id LIMIT 1').get(); from = f ? Math.min(to - 60000, Date.parse(f.ts)) : to - 3600000; } catch (_) {} }
    const out = { from, to, events: [], moods: [], sleeps: [], tests: tests || {}, needs: Object.assign({}, this.needs) };
    if (store) out.sleeps = store.sleeps.items.filter((x) => (x.end || x.at) >= from).map((x) => ({ from: x.at, to: x.end || x.at }));
    if (!this.log) return out;
    const cut = (t, n = 70) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
    const evs = this.log.all();
    const E = (x, ms, reg, text, o) => out.events.push(Object.assign({ id: x.id, ms, reg, text }, o || {}));
    for (const x of evs) {
      const ms = Date.parse(x.ts); if (!(ms >= from)) continue;
      const b = x.body || {};
      switch (x.kind) {
        case 'owner.message': E(x, ms, 'senses', 'He said: ' + cut(b.text), { turn: true }); break;
        case 'ithil.message':
          E(x, ms - 1500, 'attention', 'Focused, then chose what to say', { quiet: true });
          E(x, ms - 1200, 'workspace', 'Broadcast to every part', { bc: true, quiet: true });
          E(x, ms - 800, 'confidence', 'Claims tagged: remembered / summary / guess');
          E(x, ms - 300, 'gate', 'Gate: reply allowed');
          E(x, ms, 'workspace', 'Replies: ' + cut(b.text));
          E(x, ms + 300, 'memory', 'Event #' + x.id + ' written (passed the gate)');
          break;
        case 'system.input':
          if (b.observedKind) E(x, ms, 'prediction', 'His reply was: ' + String(b.observedKind).replace('_', ' '));
          else if (b.allowed) E(x, ms, 'gate', 'Gate: ' + b.allowed + ' allowed');
          else if (b.applied === 'settings') E(x, ms, 'gate', 'Your signed setting applied: ' + cut(b.key, 40));
          else if (b.from) E(x, ms, 'senses', cut(b.from, 20) + ': ' + cut(b.text), { turn: true });
          break;
        case 'memory.pin': E(x, ms, 'knowledge', (x.actor === 'owner' ? 'You pinned: ' : 'Kept: ') + cut(b.value, 60)); break;
        case 'memory.correct': E(x, ms, 'knowledge', 'Correction to #' + x.ref + ' (new entry)'); break;
        case 'memory.delete': E(x, ms, 'memory', 'You marked #' + x.ref + ' deleted (still in the log)'); break;
        case 'owner.restore': E(x, ms, 'memory', 'You restored #' + x.ref); break;
        case 'owner.purge': E(x, ms, 'memory', 'You erased #' + x.ref + ' (words wiped)'); break;
        case 'memory.forget': E(x, ms, 'sleep', 'Marked #' + x.ref + ' "forget" (left out of search; nothing erased)'); break;
        case 'reflection':
          if (b.sleep) E(x, ms, 'knowledge', 'Sleep summary: ' + cut(b.text));
          else if (b.field) E(x, ms, 'selfmodel', 'Self-model: ' + cut(b.field + ': ' + b.value));
          else E(x, ms, 'selfmodel', 'Reflection: ' + cut(b.text));
          break;
        case 'mood.snapshot':
          out.moods.push(Object.assign({ ms }, b));
          E(x, ms, 'needs', 'Needs by fixed rules: energy ' + Number(b.energy).toFixed(2) + ', curiosity ' + Number(b.curiosity).toFixed(2), { quiet: true });
          break;
        case 'gate.reject': E(x, ms, 'gate', 'Gate: BLOCKED (hard limit: ' + String(b.limit).replace(/_/g, ' ') + ') · ' + b.effect, { block: true }); break;
      }
    }
    for (const sl of out.sleeps) { out.events.push({ id: 's' + sl.from, ms: sl.from, reg: 'sleep', text: 'Sleep cycle starts' }); if (sl.to > sl.from) out.events.push({ id: 'w' + sl.to, ms: sl.to, reg: 'sleep', text: 'Wakes up' }); }
    out.events.sort((a, b) => a.ms - b.ms);
    if (out.events.length > 4000) out.events = out.events.slice(-4000);
    return out;
  }

  // ---- views for the screens ----
  view({ store, settings, mind }) {
    const now = this.now();
    const st = settings;
    const out = { ok: !!this.log, needs: Object.assign({}, this.needs), style: style(this.needs), moodWords: moodLabels(this.needs) };
    // Top bar
    const quiet = st.quietHours || '';
    const firsts = store.chat.items.filter((m) => m.role === 'ithil' && m.unprompted && day(m.at) === day(now)).length;
    out.top = { quiet: quiet.replace('-', '–'), firsts, firstsMax: st.messagesFirstPerDay == null ? 1 : st.messagesFirstPerDay, gate: this.log ? 'on' : 'off' };
    // Mind
    const e = this.lastEntry;
    out.workspace = e ? e.contents.map((c, i) => ({ content: c.content, from: c.source, strength: c.strength, won: i === 0 })) : [];
    out.focus = this.focus && this.focus.focus ? this.focus.focus : null;
    out.loop = this.lastLoop;
    out.active = e && e.winner ? e.winner.source : null;
    out.prediction = this.predictor.predict();
    if (!this.log) return out;
    let evs; try { evs = this.log.all(); } catch (_) { return out; }
    // Needs, last 24 hours (and the sleep band)
    const since = now - 24 * 3600000;
    out.history = evs.filter((x) => x.kind === 'mood.snapshot' && !x.purged && x.body && Date.parse(x.ts) >= since)
      .map((x) => ({ t: Date.parse(x.ts), ...x.body }));
    out.historyFrom = since;
    const sl = store.sleeps.items.filter((x) => (x.end || x.at) >= since).slice(-1)[0];
    out.sleepBand = sl ? { from: sl.at, to: sl.end || sl.at } : null;
    // Memory
    const r = rebuild(evs);
    const memKind = {}; for (const m of store.memories.items) memKind[m.id] = m;
    const pins = evs.filter((x) => x.kind === 'memory.pin');
    const stats = { events: evs.length, active: 0, deleted: 0, erased: 0 };
    const facts = [];
    for (const p of pins) {
      const state = r.states[p.id];
      if (state === 'active') stats.active++; else if (state === 'marked_deleted') stats.deleted++; else if (state === 'erased') stats.erased++;
      const key = p.body && p.body.key; const hist = r.history[p.id] || [];
      const mem = key && key.startsWith('mem:') ? memKind[key.slice(4)] : null;
      const corr = evs.filter((x) => x.kind === 'memory.correct' && x.ref === p.id);
      facts.push({ pin: p.id, key: state === 'erased' ? null : (mem ? mem.kind.replace('_', ' ') : key && key.startsWith('mem:') ? 'memory' : key), memId: key && key.startsWith('mem:') ? key.slice(4) : null,
        value: state === 'erased' ? null : hist[hist.length - 1], was: hist.length > 1 ? hist[hist.length - 2] : null,
        from: '#' + p.id + (corr.length ? ' → #' + corr[corr.length - 1].id : ''), state, by: p.actor, at: Date.parse(p.ts) });
    }
    out.memory = { stats, facts: facts.reverse().slice(0, 300),
      messages: evs.filter((x) => (x.kind === 'owner.message' || x.kind === 'ithil.message') && !x.purged).slice(-150).reverse().map((x) => ({ id: x.id, who: x.actor, text: x.body && x.body.text, at: Date.parse(x.ts) })),
      reflections: evs.filter((x) => x.kind === 'reflection' && !x.purged).slice(-60).reverse().map((x) => ({ id: x.id, text: x.body && x.body.text, at: Date.parse(x.ts) })),
      forgotten: evs.filter((x) => x.kind === 'memory.forget').slice(-60).reverse().map((x) => { const t = evs.find((y) => y.id === x.ref); return { id: x.ref, text: t && t.body && !t.purged ? (t.body.text || t.body.value || '') : '', at: Date.parse(x.ts) }; }) };
    // Gate
    const rejects = evs.filter((x) => x.kind === 'gate.reject' && x.body);
    const count = {}; for (const x of rejects) count[x.body.limit] = (count[x.body.limit] || 0) + 1;
    out.gate = {
      limits: LIMIT_ROWS.map(([code, icon, label]) => ({ code, icon, label: code === 'push_branch' ? label : label, branch: code === 'push_branch' ? (st.pushBranch || '') : null, n: count[code] || 0 })),
      recent: rejects.slice(-12).reverse().map((x) => ({ at: Date.parse(x.ts), limit: x.body.limit, effect: x.body.effect, request: x.body.requestId })),
    };
    const today = evs.filter((x) => day(Date.parse(x.ts)) === day(now));
    out.gate.today = {
      messages: today.filter((x) => x.kind === 'ithil.message').length,
      logWrites: today.length,
      sleepWrites: today.filter((x) => (x.kind === 'reflection' && x.body && x.body.sleep) || x.kind === 'memory.forget').length,
      fileWrites: today.filter((x) => x.kind === 'system.input' && x.body && x.body.allowed === 'file.write').length,
      pushes: today.filter((x) => x.kind === 'system.input' && x.body && x.body.allowed === 'git.push').length,
    };
    // Signed settings changes
    out.signed = evs.filter((x) => x.kind === 'system.input' && x.body && x.body.applied === 'settings').slice(-8).reverse().map((x) => {
      const cmd = evs.find((y) => y.id === x.body.ownerEvent);
      return { at: Date.parse(x.ts), key: x.body.key, summary: cmd && cmd.body && cmd.body.text ? cmd.body.text : x.body.key };
    });
    return out;
  }
}

module.exports = { Live, labelReply, LIMIT_ROWS };
