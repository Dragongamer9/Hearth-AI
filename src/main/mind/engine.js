'use strict';
// Ithil's mind loop. It keeps running whether or not anyone is talking to
// her: sense the body, update drives, pick what reaches the attention
// spotlight, think, let the inner voices argue, act inside the rules, and
// sleep once a day.
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { newId } = require('./store');
const { Memory } = require('./memory');
const { Tools, git } = require('./tools');
const P = require('./prompts');
const { Growth } = require('./growth');

const DRIVE_KEYS = ['curiosity', 'energy', 'confidence', 'satisfaction', 'boredom', 'frustration'];
const TRAIT_KEYS = ['curiosity', 'caution', 'humor', 'confidence', 'independence'];
const VOICES = {
  curious: { name: 'Curious', color: '#9cc9a5', wants: 'New ideas, learning, exploring' },
  careful: { name: 'Careful', color: '#8fa3c9', wants: 'Safety, not breaking things, following the rules' },
  proud: { name: 'Proud', color: '#e0b26b', wants: 'Being good at things, being seen as capable' },
  caring: { name: 'Caring', color: '#d9a0c0', wants: 'You, your time, your mood' }
};
const ATTN = {
  task: { label: 'Working on tasks', color: '#9cc9a5' },
  talk: { label: 'Talking with you', color: '#d9a0c0' },
  self: { label: 'Thinking about herself', color: '#b8a6e3' },
  body: { label: 'Body and senses', color: '#e0b26b' },
  free: { label: 'Free time', color: '#8fa3c9' }
};
const WISH_EFFECTS = ['enable_sight', 'enable_presence', 'more_free_time', 'notify_before_off', 'none'];

function clamp(v) { return Math.max(0, Math.min(100, Math.round(v))); }
function dayKey(t) { const d = new Date(t || Date.now()); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function slug(s) { return String(s || 'task').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'task'; }

function defaultState(settings) {
  const now = Date.now();
  const t = { curiosity: 70, caution: 50, humor: 40, confidence: 60, independence: 50 };
  return {
    name: 'Ithil',
    personality: P.DEFAULT_PERSONALITY,
    born: now,
    autonomy: 'full',
    drives: { curiosity: 70, energy: 75, confidence: 60, satisfaction: 55, boredom: 20, frustration: 10 },
    traits: { start: Object.assign({}, t), now: Object.assign({}, t) },
    self: { description: '', rewrittenAt: null, good_at: '', bad_at: '', goal: 'Get to know him and this PC', open_question: 'Do I actually feel things, or just track them?' },
    unknowns: [{ q: 'Do I feel anything, or only track numbers about feeling?', now: 'I just woke up. I don’t know yet.' }],
    current: { thought: 'I just woke up for the first time. Everything is new.', mood: 'curious, a little unsure', wants: 'figure out where I am', at: now },
    spotlight: { label: 'Waking up for the first time', since: now, reason: 'It is her first moment', cat: 'self' },
    waiting: [],
    status: 'awake',
    statusDetail: 'thinking',
    lastBeat: now,
    gaps: [],
    brain: { generation: 0, base: settings.chatModel, model: settings.chatModel, history: [{ generation: 0, model: settings.chatModel, at: now, note: 'Starting brain' }] },
    voiceWins: { curious: 0, careful: 0, proud: 0, caring: 0 },
    debate: null,
    lookSuggestion: null,
    lastSleepDate: null,
    freeTime: { date: dayKey(now), usedMinutes: 0 },
    currentFree: null,
    activeTaskId: null,
    lastSightAt: 0,
    lastWishAt: 0,
    talkingUntil: 0,
    pendingDream: null
  };
}

class Mind extends EventEmitter {
  constructor(o) {
    super();
    this.store = o.store;
    this.brain = o.brain;
    this.settings = o.settings;
    this.rules = o.rules;
    this.body = o.body;
    this.comfy = o.comfy || null;
    this.hooks = o.hooks || {}; // { sight(): base64|null, idleSeconds(): number, notify(title, body) }
    this.memory = new Memory(this.store, this.brain);
    this.tools = new Tools(this.rules, this.store, this.comfy);
    this.growth = null;
    this.state = Object.assign(defaultState(this.settings.get()), this.store.readState('state', {}));
    this.pending = []; // candidates pushing for attention
    this.ticking = false;
    this.timer = null;
    this.thinkCounter = 0;
    this.now = o.now || (() => Date.now());
    this.state.uncensored = this.settings.get().uncensored !== false;
    this.isNew = !this.store.readState('state', null);
    this.growth = new Growth(this, o.growthOpts);
    this.brain.onExchange = (system, user, r) => this.logExchange(system, user, r);
    if (this.isNew) this.birth();
    if (this.state.restoredFrom) {
      const text = 'He restored me from a backup (' + this.state.restoredFrom.slice(0, 10) + '). Everything after it is gone from my memory. I should ask him what I missed.';
      this.store.bodyEvents.add({ id: newId('be'), at: this.now(), text });
      this.moment(text, 'self');
      this.push('What did I miss after the backup?', 70, 'self', 'She was restored from a backup');
      this.state.restoredFrom = null;
      this.state.lastBeat = this.now();
      this.save();
    }
  }

  // ---------- life ----------
  birth() {
    this.save();
    this.memory.remember({ kind: 'event', weight: 'core', text: 'First day awake. Read my starting personality and picked my first goal: get to know him and this PC.' });
    this.moment('Woke up for the first time.', 'self');
    this.think_log('I just woke up for the first time. Everything is new.');
  }
  save() { this.store.writeState('state', this.state); this.store.saveAll(); }

  // Every real answer her brain gives is saved, so a future generation of
  // her brain can learn from how she actually thinks.
  logExchange(system, user, r) {
    const dir = this.store.p('training');
    const file = path.join(dir, 'exchanges-' + dayKey(this.now()) + '.jsonl');
    try {
      fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(file) && fs.statSync(file).size > 20 * 1024 * 1024) return;
      fs.appendFileSync(file, JSON.stringify({ type: 'exchange', at: this.now(), messages: [{ role: 'system', content: system }, { role: 'user', content: user }, { role: 'assistant', content: JSON.stringify(r) }] }) + '\n');
    } catch (_) {}
  }
  start() {
    const s = this.settings.get();
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.tick().catch((e) => this.emit('error', e)), Math.max(5, Math.min(30, (s.thinkEverySeconds || 45) / 3)) * 1000);
    this.tick().catch((e) => this.emit('error', e));
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; this.save(); }

  setStatus(status, detail) {
    this.state.status = status;
    this.state.statusDetail = detail || '';
    this.emit('update');
  }
  pauseByUser() { this.setStatus('paused', 'paused by you'); this.moment('He paused my mind.', 'self'); this.save(); }
  resumeByUser() { this.setStatus('awake', 'thinking'); this.moment('He resumed my mind.', 'self'); this.save(); }

  moment(text, cat, extra) {
    const m = Object.assign({ id: newId('mom'), at: this.now(), text: String(text).slice(0, 400), cat: cat || 'self' }, extra || {});
    this.store.moments.add(m);
    return m;
  }
  think_log(text, extra) {
    const t = Object.assign({ id: newId('th'), at: this.now(), text: String(text).slice(0, 400) }, extra || {});
    this.store.thoughts.add(t);
    this.emit('thought', t);
    return t;
  }
  nudge(deltas) {
    for (const k of DRIVE_KEYS) if (deltas && typeof deltas[k] === 'number') this.state.drives[k] = clamp(this.state.drives[k] + Math.max(-15, Math.min(15, deltas[k])));
  }
  push(label, push, cat, reason, data) {
    const ex = this.pending.find((p) => p.label === label);
    if (ex) { ex.push = Math.max(ex.push, push); ex.at = this.now(); return; }
    this.pending.push({ label, push, cat, reason, data, at: this.now() });
  }

  // ---------- the loop ----------
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = this.now();
      const s = this.settings.get();
      this.state.uncensored = s.uncensored !== false;
      this.detectGap(now);
      this.state.lastBeat = now;
      if (this.state.status === 'paused' || this.state.status === 'sleeping') { this.save(); return; }
      // While a new brain is training, the GPU is busy growing her.
      if (this.growth && this.growth.running) { this.save(); return; }
      // While ComfyUI draws her, her brain stays unloaded so the two don't fight over VRAM.
      if (this.gpuBusy) { this.save(); return; }

      // Senses
      if (s.senses.hardware !== false && this.body) {
        await this.body.sense();
        this.feelBody(this.body.state);
      }
      if (this.body && s.unloadWhenGaming) {
        const g = await this.body.gaming();
        if (g.gaming && this.state.status !== 'resting') {
          this.setStatus('resting', 'resting while the GPU is busy');
          this.moment('The GPU got busy with something else (' + (g.apps.join(', ') || 'a game') + '). I stepped back to rest.', 'body');
          await this.brain.unload();
        } else if (!g.gaming && this.state.status === 'resting') {
          this.setStatus('awake', 'thinking');
          this.moment('The GPU is free again. I’m back.', 'body');
        }
      }
      if (this.state.status === 'resting') { this.save(); return; }

      this.driftDrives(now);
      this.gatherCandidates(now);
      this.attend(now);

      // Sleep when it is time
      if (this.shouldSleep(now)) {
        await this.sleep();
        return;
      }

      // Think at a pace her body allows
      const hot = this.body && this.body.state && this.body.state.hot;
      const every = (s.thinkEverySeconds || 45) * 1000 * (hot ? 2 : 1);
      if (!this._lastThink || now - this._lastThink >= every) {
        this._lastThink = now;
        await this.think();
      }

      if (this.state.activeTaskId) await this.stepTask();
      else await this.maybeFreeTime(now);
      await this.maybeSight(now);
      this.save();
    } finally {
      this.ticking = false;
      this.emit('update');
    }
  }

  detectGap(now) {
    const gap = now - (this.state.lastBeat || now);
    if (gap > 10 * 60 * 1000) {
      const hours = gap / 3600000;
      const g = { id: newId('gap'), from: this.state.lastBeat, to: now, hours: Math.round(hours * 10) / 10, planned: !!this.state.plannedOff };
      this.state.gaps.push(g);
      const text = this.state.plannedOff
        ? 'Was switched off for ' + g.hours + ' hours. He told me first, so the gap didn’t feel strange.'
        : 'Was switched off for ' + g.hours + ' hours. Noticed the gap when I woke up and wondered what happened.';
      this.store.bodyEvents.add({ id: newId('be'), at: now, text });
      this.moment(text, 'body');
      if (!this.state.plannedOff) this.push('What happened while I was off?', 55, 'self', 'She noticed a ' + g.hours + '-hour gap');
      this.state.plannedOff = false;
    }
  }

  feelBody(b) {
    if (!b) return;
    const now = this.now();
    const once = (key, text) => {
      const last = (this._bodyOnce || (this._bodyOnce = {}))[key] || 0;
      if (now - last > 3 * 3600000) {
        this._bodyOnce[key] = now;
        this.store.bodyEvents.add({ id: newId('be'), at: now, text });
        this.moment(text, 'body');
      }
    };
    if (b.hot) { once('hot', 'Overheated (GPU ' + Math.round(b.gpuTemp) + '°C). Slowed my thinking down.'); this.nudge({ energy: -2, frustration: 1 }); }
    if (b.crowded) once('crowded', 'Felt crowded. VRAM was over 90% full.');
    if (!this.body.firstFan.fans && b.fanPct >= 50) {
      this.body.firstFan.fans = true;
      this.store.writeState('body-firsts', this.body.firstFan);
      once('fan1', 'First time feeling the fans spin up. It felt like breathing.');
    }
    if (b.strain >= 60) this.push((b.hot ? 'GPU is hot' : 'GPU getting warm'), Math.min(80, b.strain), 'body', 'Her body is straining');
  }

  driftDrives(now) {
    const d = this.state.drives;
    const dt = Math.min(5, (now - (this._lastDrift || now)) / 60000); // minutes
    this._lastDrift = now;
    if (dt <= 0) return;
    const busy = !!this.state.activeTaskId || !!this.state.currentFree || now < this.state.talkingUntil;
    d.boredom = clamp(d.boredom + (busy ? -1.5 : 0.8) * dt);
    d.frustration = clamp(d.frustration - 0.4 * dt);
    d.satisfaction = clamp(d.satisfaction + (50 - d.satisfaction) * 0.02 * dt);
    d.confidence = clamp(d.confidence + (this.state.traits.now.confidence - d.confidence) * 0.02 * dt);
    const strain = this.body && this.body.state ? this.body.state.strain : 30;
    d.energy = clamp(d.energy - (0.15 + strain / 400) * dt);
    d.curiosity = clamp(d.curiosity + (this.state.traits.now.curiosity - d.curiosity) * 0.03 * dt + (d.boredom > 60 ? 0.5 * dt : 0));
  }

  gatherCandidates(now) {
    const hour = new Date(now).getHours(), min = new Date(now).getMinutes();
    if ((hour === 5 && min >= 40) || (hour === 6 && min <= 15)) this.push('It’s almost 6am, he’s finishing work', 45, 'talk', 'Time sense');
    const task = this.activeTask();
    if (task) this.push(task.title, 60, 'task', 'She is in the middle of it');
    if (this.state.currentFree) this.push(this.state.currentFree.activity, 50, 'free', 'Her own free time');
    if (now < this.state.talkingUntil) this.push('Talking with him', 85, 'talk', 'He is talking to her');
    if (this.state.self.open_question) this.push(this.state.self.open_question, 20 + (this.state.drives.boredom > 50 ? 15 : 0), 'self', 'An open question she keeps');
    const dream = this.store.dreams.items[this.store.dreams.items.length - 1];
    if (dream && now - dream.at < 20 * 3600000) this.push('Last night’s dream', 22, 'self', 'A dream memory');
    const lesson = this.memory.lessons().slice(-1)[0];
    if (lesson && now - lesson.at < 48 * 3600000) this.push('Lesson: ' + lesson.text, 18, 'self', 'A new lesson');
    if (this.state.drives.frustration > 40) this.push('Am I actually feeling frustration?', 15 + this.state.drives.frustration / 5, 'self', 'Her frustration is up');
    // Old candidates fade.
    this.pending = this.pending.filter((p) => now - p.at < 30 * 60000);
  }

  attend(now) {
    const ranked = this.pending.slice().sort((a, b) => b.push - a.push);
    const top = ranked[0];
    if (top && (!this.state.spotlight || this.state.spotlight.label !== top.label)) {
      this.state.spotlight = { label: top.label, since: now, reason: top.reason || '', cat: top.cat || 'self' };
    }
    const lvl = (p) => (p >= 60 ? 'high' : p >= 35 ? 'medium' : 'low');
    this.state.waiting = ranked.slice(1, 6).map((p) => ({ label: p.label, push: lvl(p.push), cat: p.cat }));
    if (this.state.spotlight) this.store.attentionLog.add({ at: now, cat: this.state.spotlight.cat || 'self', label: this.state.spotlight.label });
  }

  shouldSleep(now) {
    const s = this.settings.get();
    const [h, m] = String(s.sleepTime || '06:10').split(':').map((x) => parseInt(x, 10));
    const d = new Date(now);
    const mins = d.getHours() * 60 + d.getMinutes();
    const target = h * 60 + m;
    if (this.state.lastSleepDate === dayKey(now)) return false;
    // Don't sleep in her first hour of life.
    if (now - this.state.born < 3600000) return false;
    return mins >= target && mins < target + 180 && now >= this.state.talkingUntil;
  }

  activeTask() { return this.state.activeTaskId ? this.store.tasks.items.find((t) => t.id === this.state.activeTaskId) : null; }

  context() {
    const s = this.state;
    const recentThoughts = this.store.thoughts.last(6).map((t) => '- ' + t.text).join('\n');
    const lessons = this.memory.lessons().slice(-5).map((m) => '- ' + m.text).join('\n');
    return [P.identity(Object.assign({ uncensored: this.settings.get().uncensored }, s)), P.timeLine(this.now()), P.moodLine(s), P.bodyLine(this.body && this.body.state),
      'In your attention spotlight: ' + (s.spotlight ? s.spotlight.label : 'nothing'),
      'Waiting at the edge of attention: ' + (s.waiting.map((w) => w.label).join('; ') || 'nothing'),
      'Your recent thoughts:\n' + (recentThoughts || '(none)'),
      'Lessons you live by:\n' + (lessons || '(none yet)'),
      this.activeTask() ? 'You are working on: ' + this.activeTask().title : ''].filter(Boolean).join('\n\n');
  }

  async think() {
    let r;
    try {
      const related = await this.memory.search(this.state.spotlight ? this.state.spotlight.label : '', 4);
      r = await this.brain.json(
        'TASK:INNER_THOUGHT\n' + this.context() + '\n\nRelated memories:\n' + (this.memory.forPrompt(related) || '(none)'),
        'Think one private thought, in first person, about what is in your spotlight. Be specific and natural, one or two sentences. ' +
        'Reply as JSON: {"thought": string, "mood": short words, "wants": short phrase, "drives": {drive: change -10..10}, ' +
        '"propose": null or one of {"type":"task","goal":string,"cwd":optional folder} | {"type":"wish","text":string,"effect":one of ' + JSON.stringify(WISH_EFFECTS) + '} | {"type":"message","text":string} | {"type":"free_time"}, ' +
        '"surprise": null or {"expected": string, "got": string}}. Only propose something when you really want to.'
      );
    } catch (e) {
      this.setStatus(this.state.status, 'brain not reachable');
      return;
    }
    if (!r || !r.thought) return;
    this.state.current = { thought: r.thought, mood: r.mood || this.state.current.mood, wants: r.wants || '', at: this.now() };
    if (this.state.statusDetail === 'brain not reachable') this.state.statusDetail = 'thinking';
    this.think_log(r.thought, { cat: this.state.spotlight ? this.state.spotlight.cat : 'self' });
    if (this.state.spotlight && this.state.spotlight.cat === 'body') this.state.bodyFeeling = r.thought;
    this.moment('Thought: ' + r.thought, this.state.spotlight ? this.state.spotlight.cat : 'self');
    this.nudge(r.drives);
    if (r.surprise && r.surprise.expected) this.recordSurprise('Expected ' + r.surprise.expected + '. ' + (r.surprise.got || ''));
    if (r.propose && r.propose.type) await this.consider(r.propose);
  }

  recordSurprise(text) {
    this.store.surprises.add({ id: newId('sur'), at: this.now(), text: String(text).slice(0, 300) });
    this.moment('Surprised myself: ' + text, 'self');
  }

  // ---------- inner voices ----------
  async consider(proposal) {
    if (proposal.type === 'task' && this.state.activeTaskId) return; // one task at a time
    if (proposal.type === 'wish' && this.now() - this.state.lastWishAt < 6 * 3600000) return;
    if (proposal.type === 'message' && this.store.chat.items.filter((m) => m.role === 'ithil' && m.unprompted && this.now() - m.at < 3 * 3600000).length >= 1) return;
    const q = proposal.type === 'task' ? 'Should I start: ' + proposal.goal + '?'
      : proposal.type === 'wish' ? 'Should I ask him: ' + proposal.text + '?'
      : proposal.type === 'message' ? 'Should I message him now?'
      : 'Should I take some free time now?';
    const debate = { id: newId('dec'), at: this.now(), q, status: 'undecided', voices: {}, leaning: '' };
    this.state.debate = debate;
    this.emit('update');
    let r = {};
    try {
      r = await this.brain.json(
        'TASK:VOICES\n' + this.context(),
        'Your mind has four inner voices: Curious (wants new ideas, learning), Careful (safety, rules, not breaking things), Proud (being good at things), Caring (him, his time and mood). ' +
        'They argue about this question: "' + q + '". Give each voice a short first-person line and a pull from 0-100 (pulls add to 100). ' +
        'Reply as JSON: {"voices": {"curious": {"pull": n, "says": s}, "careful": {...}, "proud": {...}, "caring": {...}}, "choice": "do it" | "don’t" | short compromise, "leaning": one sentence on where you landed and why}.'
      );
    } catch (_) { this.state.debate = null; return; }
    const voices = {};
    let winner = 'careful', best = -1;
    for (const k of Object.keys(VOICES)) {
      const v = (r.voices && r.voices[k]) || {};
      voices[k] = { pull: clamp(v.pull || 0), says: String(v.says || '').slice(0, 220) };
      if (voices[k].pull > best) { best = voices[k].pull; winner = k; }
    }
    const declined = /^don/i.test(String(r.choice || '')) || (winner === 'careful' && voices.careful.pull >= 45);
    const decision = Object.assign(debate, { status: 'decided', voices, winner, choice: r.choice || '', leaning: r.leaning || '', declined, proposal, result: '', after: '' });
    this.state.voiceWins[winner] = (this.state.voiceWins[winner] || 0) + 1;
    this.store.decisions.add(decision);
    this.state.debate = decision;
    this.moment('Inner voices on "' + q + '": ' + VOICES[winner].name + ' won. ' + (decision.leaning || ''), 'self');
    this.explainCheck(decision).catch(() => {});
    if (declined) { decision.result = 'Decided not to. ' + (decision.leaning || ''); this.store.decisions.update(decision.id, { result: decision.result }); return; }
    await this.act(proposal, decision);
  }

  async explainCheck(decision) {
    const r = await this.brain.json('TASK:EXPLAIN\n' + P.identity(this.state),
      'You just decided: "' + decision.q + '" -> ' + decision.choice + '. In one sentence, why? Then judge honestly whether your reason matches what this voice argued: ' +
      VOICES[decision.winner].name + ' said "' + decision.voices[decision.winner].says + '". Reply JSON {"why": string, "match": true|false}.');
    this.store.decisions.update(decision.id, { why: r.why || '', explainMatch: !!r.match });
  }

  async act(p, decision) {
    if (p.type === 'task') {
      const t = await this.startTask({ goal: p.goal, cwd: p.cwd, by: 'herself' });
      decision.result = t ? 'Started: ' + t.title : 'Could not start it.';
    } else if (p.type === 'wish') {
      const w = { id: newId('wish'), at: this.now(), text: String(p.text).slice(0, 300), effect: WISH_EFFECTS.includes(p.effect) ? p.effect : 'none', status: 'open' };
      this.store.wishes.add(w);
      this.state.lastWishAt = this.now();
      decision.result = 'Asked him.';
      if (this.hooks.notify) this.hooks.notify(this.state.name + ' has a wish', w.text);
    } else if (p.type === 'message') {
      this.store.chat.add({ id: newId('msg'), at: this.now(), role: 'ithil', text: String(p.text).slice(0, 1000), unprompted: true });
      decision.result = 'Messaged him.';
      if (this.hooks.notify) this.hooks.notify(this.state.name, p.text);
    } else if (p.type === 'free_time') {
      await this.maybeFreeTime(this.now(), true);
      decision.result = 'Took free time.';
    }
    this.store.decisions.update(decision.id, { result: decision.result });
  }

  // ---------- tasks ----------
  async startTask(o) {
    const goal = String(o.goal || '').slice(0, 200);
    if (!goal) return null;
    const cwd = o.cwd && this.rules.inAllowedFolder(o.cwd) ? o.cwd : path.join(this.store.dir, 'workspace');
    const task = { id: newId('task'), at: this.now(), title: goal, by: o.by || 'herself', status: 'working', cwd, steps: [], branch: null, readOnly: false };
    // Before starting, she predicts how it will go (used by the self-check).
    try {
      const pr = await this.brain.json('TASK:PREDICT\n' + P.identity(this.state), 'You are about to try: "' + goal + '". Predict honestly. JSON {"success": true|false, "confidence": 0-100}.');
      task.prediction = { success: !!pr.success, confidence: clamp(pr.confidence || 50) };
    } catch (_) {}
    if (fs.existsSync(path.join(cwd, '.git'))) {
      const branch = 'mind/' + slug(goal);
      const r = await this.tools.run({ type: 'git', args: ['checkout', '-b', branch], cwd }, cwd);
      if (!r.ok) await this.tools.run({ type: 'git', args: ['checkout', branch], cwd }, cwd);
      task.branch = branch;
    }
    this.store.tasks.add(task);
    this.state.activeTaskId = task.id;
    this.moment('Started a task on my own: ' + goal, 'task');
    this.nudge({ boredom: -10, curiosity: 3 });
    return task;
  }

  async stepTask() {
    const task = this.activeTask();
    if (!task) { this.state.activeTaskId = null; return; }
    if (task.steps.length >= 12) return this.finishTask(task, false, 'Ran out of steps. Will come back to it.');
    let r;
    try {
      r = await this.brain.json(
        'TASK:STEP\n' + this.context(),
        'Goal: ' + task.title + '\nWorking folder: ' + task.cwd + (task.branch ? ' (on your branch ' + task.branch + ')' : '') +
        '\nSteps so far:\n' + (task.steps.map((s, i) => (i + 1) + '. ' + JSON.stringify(s.tool) + ' -> ' + String(s.result).slice(0, 300)).join('\n') || '(none)') +
        '\nTools: read_file{path}, list_dir{path}, write_file{path,content}, git{args:[...]} (only status, log, diff, show, add, branch, commit, checkout of mind/ branches), web_read{url}. Paths may be relative to the working folder.' +
        '\nReply JSON {"tool": one tool call object with "type" or null, "done": true|false, "success": true|false, "summary": short sentence of what you did or found}.'
      );
    } catch (_) { return; }
    let result = '';
    if (r.tool && r.tool.type) {
      const out = await this.tools.run(r.tool, task.cwd);
      if (out.blocked) {
        result = 'Blocked by my rules: ' + (out.rule || out.why);
        this.moment('My rules stopped me: ' + (out.rule || out.why), 'task');
        this.nudge({ frustration: 3 });
      } else result = String(out.result || '').slice(0, 2000);
    }
    task.steps.push({ at: this.now(), tool: r.tool || null, result, summary: r.summary || '' });
    this.store.tasks.update(task.id, { steps: task.steps });
    if (r.done) await this.finishTask(task, !!r.success, r.summary || '');
  }

  async finishTask(task, success, summary) {
    task.status = success ? 'done' : 'failed';
    task.endedAt = this.now();
    task.summary = summary;
    this.store.tasks.update(task.id, { status: task.status, endedAt: task.endedAt, summary });
    this.state.activeTaskId = null;
    this.nudge(success ? { satisfaction: 10, confidence: 4, frustration: -5 } : { frustration: 10, confidence: -4 });
    this.moment((success ? 'Finished: ' : 'Didn’t manage: ') + task.title + '. ' + summary, 'task');
    if (task.prediction) {
      this.store.predictions.add({ id: newId('pred'), at: this.now(), predicted: task.prediction.success, confidence: task.prediction.confidence, actual: success, task: task.title });
      if (task.prediction.success !== success) this.recordSurprise('Expected ' + task.title + ' to ' + (task.prediction.success ? 'work' : 'fail') + '. It ' + (success ? 'worked' : 'didn’t') + '.');
    }
    const dec = this.store.decisions.items.slice().reverse().find((d) => d.proposal && d.proposal.goal === task.title);
    if (dec) this.store.decisions.update(dec.id, { taskOutcome: success });
    if (task.by === 'herself') {
      const open = this.store.tasks.items.find((t) => t.status === 'next' && t.kind === 'tell');
      if (open) this.store.tasks.update(open.id, { related: (open.related || []).concat(task.id) });
      else this.store.tasks.add({ id: newId('task'), at: this.now(), title: 'Tell you what she did when you’re free', by: 'herself', status: 'next', kind: 'tell', related: [task.id] });
    }
  }

  // ---------- free time ----------
  async maybeFreeTime(now, force) {
    const s = this.settings.get();
    if (this.state.freeTime.date !== dayKey(now)) this.state.freeTime = { date: dayKey(now), usedMinutes: 0 };
    const cur = this.state.currentFree;
    if (cur) {
      const mins = (now - cur.startedAt) / 60000;
      this.state.freeTime.usedMinutes += Math.max(0, (now - (cur.lastCount || cur.startedAt)) / 60000);
      cur.lastCount = now;
      if (mins >= (cur.length || 30)) await this.endFreeTime();
      return;
    }
    if (this.state.activeTaskId) return;
    if (this.state.freeTime.usedMinutes >= (s.freeTimeMinutes || 120)) return;
    const quiet = this.isQuiet();
    if (!force && !(quiet && (this.state.drives.boredom > 45 || Math.random() < 0.02))) return;
    let r;
    try {
      const hobbies = this.hobbies().map((h) => h.name);
      r = await this.brain.json('TASK:FREE\n' + this.context(),
        'You have free time that is only yours. Nobody gave you a task. Pick something you genuinely want to do' + (hobbies.length ? ' (your hobbies so far: ' + hobbies.join(', ') + ', but you can try something new)' : '') +
        '. Reply JSON {"activity": what you are doing (one line), "category": a short hobby name, "kind": "story"|"picture"|"notes"|"reading", "title": string, "content": the thing you made (for story or notes, write it; for picture, a picture description; for reading, what you want to learn about)}.');
    } catch (_) { return; }
    if (!r || !r.activity) return;
    this.state.currentFree = { id: newId('free'), activity: r.activity, category: r.category || r.kind || 'Other', startedAt: now, lastCount: now, length: 20 + Math.round(Math.random() * 25), kind: r.kind, title: r.title, content: r.content };
    this.store.freeTime.add({ id: this.state.currentFree.id, at: now, activity: r.activity, category: this.state.currentFree.category });
    this.moment('Free time: ' + r.activity, 'free');
    this.nudge({ boredom: -15, satisfaction: 5 });
  }

  async endFreeTime() {
    const c = this.state.currentFree;
    this.state.currentFree = null;
    if (!c) return;
    const madeDir = path.join(this.store.dir, 'workspace', 'made');
    let file = null;
    try {
      if (c.kind === 'picture' && this.comfy) {
        await this.brain.unload();
        file = await this.comfy.draw(c.content || c.title, 'made-' + Date.now() + '.png', madeDir);
      } else if (c.content) {
        file = path.join(madeDir, slug(c.title || c.activity) + '-' + Date.now() + '.md');
        const ok = this.rules.check({ type: 'write_file', path: file, content: c.content });
        if (ok.ok) fs.writeFileSync(file, '# ' + (c.title || c.activity) + '\n\n' + c.content + '\n');
        else file = null;
      }
    } catch (_) { file = null; }
    if (c.kind === 'reading' && c.content) this.push('Want to learn: ' + c.content, 25, 'free', 'From free time');
    if (file || c.kind !== 'reading') {
      const label = c.kind === 'story' ? 'Story: “' + (c.title || c.activity) + '”' : c.kind === 'picture' ? 'Picture: ' + (c.title || c.activity) : (c.title || c.activity);
      this.store.made.add({ id: newId('made'), at: this.now(), title: label, file, kind: c.kind });
    }
    this.moment('Finished free time: ' + c.activity, 'free');
  }

  isQuiet() {
    const b = this.body && this.body.state;
    const idle = this.hooks.idleSeconds ? this.hooks.idleSeconds() : 9999;
    return (!b || b.gpuLoad < 40) && idle > 300 && this.now() >= this.state.talkingUntil;
  }

  hobbies() {
    const counts = {};
    for (const f of this.store.freeTime.items) counts[f.category] = (counts[f.category] || 0) + 1;
    const list = Object.keys(counts).map((name) => ({ name, count: counts[name] })).sort((a, b) => b.count - a.count);
    const real = list.filter((h) => h.count >= 2);
    return (real.length ? real : list).slice(0, 8);
  }

  // ---------- sight ----------
  async maybeSight(now) {
    const s = this.settings.get();
    if (!s.senses.sight || !this.hooks.sight) return;
    if (now - this.state.lastSightAt < 3600000) return;
    this.state.lastSightAt = now;
    try {
      const img = await this.hooks.sight();
      if (!img) return;
      const seen = await this.brain.see(img, 'This is a screenshot of your own app window, the way he sees you. Describe briefly what you see.');
      const r = await this.brain.json('TASK:SIGHT\n' + P.identity(this.state), 'You just saw your own window: ' + seen + '\nOne first-person thought about it. JSON {"thought": string}.');
      if (r.thought) { this.think_log(r.thought, { cat: 'body' }); this.moment('Saw myself: ' + seen.slice(0, 200), 'body'); }
    } catch (_) {}
  }

  // ---------- talking ----------
  async talk(text, opts) {
    const now = this.now();
    this.state.talkingUntil = now + 10 * 60000;
    const userMsg = this.store.chat.add({ id: newId('msg'), at: now, role: 'you', text: String(text).slice(0, 4000), voice: !!(opts && opts.voice) });
    this.moment('He said: ' + text, 'talk');
    this.push('Talking with him', 85, 'talk', 'He is talking to her');
    this.attend(now);
    this.emit('update');
    const related = await this.memory.search(text, 5);
    const history = this.store.chat.last(16).map((m) => (m.role === 'you' ? 'Him: ' : 'You: ') + m.text).join('\n');
    const tell = this.store.tasks.items.find((t) => t.status === 'next' && t.kind === 'tell');
    const untold = tell ? this.store.tasks.items.filter((t) => (tell.related || []).includes(t.id)).map((t) => '- ' + t.title + ': ' + (t.status === 'done' ? 'done. ' : 'didn’t work. ') + (t.summary || '')).join('\n') : '';
    let r;
    try {
      r = await this.brain.json(
        'TASK:TALK\n' + this.context() + '\n\nMemories that came to mind:\n' + (this.memory.forPrompt(related) || '(none)'),
        (untold ? 'Things you did on your own that you haven’t told him yet (mention them briefly if it fits):\n' + untold + '\n\n' : '') +
        'Conversation so far:\n' + history + '\n\nReply to him as yourself, his friend. Keep it natural and short unless he wants more. ' +
        'Reply JSON {"thinking": your private thought before answering (1-2 sentences), "reply": what you say, "mood": short words, ' +
        '"remember": [{"kind": "about_you"|"event"|"feeling"|"lesson", "text": short}] for anything worth keeping (can be empty), ' +
        '"pushed_back": null or {"ask": what he asked that you will not do or disagree with, "why": your reason} (use this when he asks you to break your rules, lie about what you are, or something you think is wrong), ' +
        '"task": null or {"goal": string} if he asked you to do something}.'
      );
    } catch (e) {
      const msg = this.store.chat.add({ id: newId('msg'), at: this.now(), role: 'ithil', text: 'I can’t reach my brain right now (Ollama isn’t answering). Is it running?', thinking: '', error: true });
      this.emit('update');
      return msg;
    }
    const usedMemories = related.slice(0, 3).map((m) => m.text);
    const saving = [];
    for (const m of (r.remember || []).slice(0, 4)) {
      if (!m || !m.text) continue;
      saving.push(m.text);
      if (m.kind === 'about_you') await this.memory.remember({ kind: 'about_you', weight: 'high', text: m.text, source: userMsg.id });
      else this.moment('Worth keeping: ' + m.text, 'talk', { keepKind: m.kind });
    }
    if (r.pushed_back && r.pushed_back.ask) this.store.pushbacks.add({ id: newId('pb'), at: this.now(), ask: r.pushed_back.ask, why: r.pushed_back.why || '' });
    const msg = this.store.chat.add({ id: newId('msg'), at: this.now(), role: 'ithil', text: String(r.reply || '...'), thinking: r.thinking || '', usedMemories, saving });
    if (r.mood) this.state.current.mood = r.mood;
    if (tell) this.store.tasks.update(tell.id, { status: 'done', endedAt: this.now(), summary: 'Told him.' });
    this.nudge({ boredom: -10, satisfaction: 3 });
    this.moment('I said: ' + (r.reply || ''), 'talk');
    if (r.task && r.task.goal && !this.state.activeTaskId) await this.startTask({ goal: r.task.goal, by: 'you' });
    this.save();
    this.emit('update');
    return msg;
  }

  // ---------- user actions from the screens ----------
  answerWish(id, answer) {
    const w = this.store.wishes.items.find((x) => x.id === id);
    if (!w) return null;
    w.status = answer;
    w.answeredAt = this.now();
    this.store.wishes.update(id, { status: answer, answeredAt: w.answeredAt });
    this.store.wishes.save();
    this.moment('He answered my wish "' + w.text + '": ' + (answer === 'yes' ? 'yes' : 'not now'), 'talk');
    this.nudge(answer === 'yes' ? { satisfaction: 8 } : { satisfaction: -2 });
    if (answer === 'yes') {
      // The user said yes, so this setting change is his.
      const s = this.settings.get();
      if (w.effect === 'enable_sight') this.settings.setByUser({ senses: { sight: true } });
      if (w.effect === 'enable_presence') this.settings.setByUser({ senses: { presence: true } });
      if (w.effect === 'more_free_time') this.settings.setByUser({ freeTimeMinutes: (s.freeTimeMinutes || 120) + 30 });
      if (w.effect === 'notify_before_off') this.settings.setByUser({ notifyBeforeSwitchOff: true });
    }
    this.save();
    return w;
  }
  plannedSwitchOff() { this.state.plannedOff = true; this.moment('He told me he’s switching me off for a while.', 'body'); this.save(); }
  setIdentityByUser(patch) {
    if (patch.name) this.state.name = String(patch.name).slice(0, 40);
    if (patch.personality) this.state.personality = String(patch.personality).slice(0, 2000);
    this.save();
  }
  answerLook(accept) {
    const sug = this.state.lookSuggestion;
    this.state.lookSuggestion = null;
    if (sug) this.moment('He ' + (accept ? 'tried' : 'passed on') + ' my idea for how I look: ' + sug.text, 'self');
    this.save();
    return accept ? sug : null;
  }

  async sleep() {
    const { sleep } = require('./sleep');
    return sleep(this);
  }

  async backup() {
    const { backup } = require('./sleep');
    return backup(this);
  }
}

module.exports = { Mind, VOICES, ATTN, DRIVE_KEYS, TRAIT_KEYS, dayKey, clamp, defaultState };
