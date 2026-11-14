'use strict';
// Once a day Ithil sleeps. She sorts the day's moments into lasting memories
// and lessons, dreams, rewrites how she sees herself, runs tests on her own
// mind, writes her day out as training data for a future model of her own,
// and backs up her whole mind.
const fs = require('fs');
const path = require('path');
const { newId } = require('./store');
const P = require('./prompts');

function dayKey(t) { const d = new Date(t || Date.now()); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function clamp(v) { return Math.max(0, Math.min(100, Math.round(v))); }
function shuffle(a) { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }

function copyDir(src, dst, skip) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.includes(e.name)) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d, []);
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

async function backup(mind) {
  mind.save();
  const name = new Date(mind.now()).toISOString().replace(/[:.]/g, '-');
  const dst = mind.store.p('backups', name);
  copyDir(mind.store.dir, dst, ['backups', 'workspace', 'training']);
  mind.state.lastBackup = mind.now();
  // Keep the last 14 backups.
  const all = fs.readdirSync(mind.store.p('backups')).sort();
  for (const old of all.slice(0, Math.max(0, all.length - 14))) fs.rmSync(mind.store.p('backups', old), { recursive: true, force: true });
  mind.save();
  return name;
}

function listBackups(store) {
  try { return fs.readdirSync(store.p('backups')).sort().reverse(); } catch (_) { return []; }
}

// Restore replaces her current mind with a backup. Called only by the user.
function restore(store, name) {
  const src = store.p('backups', name);
  if (!fs.existsSync(src)) return false;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = store.p(e.name);
    if (e.isDirectory()) { fs.rmSync(d, { recursive: true, force: true }); copyDir(s, d, []); } else fs.copyFileSync(s, d);
  }
  return true;
}

function exportTraining(mind, moments) {
  // Chat-format examples of her own life, for fine-tuning a model of her own later.
  const dir = mind.store.p('training');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, dayKey(mind.now()) + '.jsonl');
  const sys = P.identity(mind.state);
  const since = mind.state.lastSleepAt || 0;
  const lines = [];
  const chat = mind.store.chat.items.filter((m) => m.at > since && !m.error);
  for (let i = 0; i < chat.length; i++) {
    if (chat[i].role !== 'you') continue;
    const reply = chat.slice(i + 1).find((m) => m.role === 'ithil');
    if (!reply) continue;
    const ctx = chat.slice(Math.max(0, i - 6), i + 1).map((m) => ({ role: m.role === 'you' ? 'user' : 'assistant', content: m.text }));
    lines.push({ type: 'talk', messages: [{ role: 'system', content: sys }].concat(ctx, [{ role: 'assistant', content: reply.text }]), thinking: reply.thinking || '' });
  }
  for (const t of mind.store.thoughts.items.filter((x) => x.at > since)) lines.push({ type: 'thought', messages: [{ role: 'system', content: sys }, { role: 'user', content: '(inner thought)' }, { role: 'assistant', content: t.text }] });
  for (const d of mind.store.decisions.items.filter((x) => x.at > since && x.why)) lines.push({ type: 'decision', messages: [{ role: 'system', content: sys }, { role: 'user', content: d.q }, { role: 'assistant', content: d.choice + '. ' + d.why }] });
  if (lines.length) fs.appendFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return lines.length;
}

async function mirrorTest(mind, opts) {
  const o = opts || {};
  const real = shuffle(mind.store.thoughts.items.slice(-300)).slice(0, 5).map((t) => t.text);
  if (real.length < 3) return null;
  let fakes = [];
  try {
    const r = await mind.brain.json('TASK:FAKE_THOUGHTS\nYou write plausible inner thoughts for a generic AI assistant that is NOT Ithil.',
      'Write ' + real.length + ' short first-person inner thoughts a generic AI assistant might have. JSON {"thoughts": [string]}.', { temperature: 0.9 });
    fakes = (r.thoughts || []).slice(0, real.length);
  } catch (_) { return null; }
  const items = shuffle(real.map((t) => ({ t, real: true })).concat(fakes.map((t) => ({ t, real: false }))));
  let picks = [];
  try {
    const r = await mind.brain.json('TASK:MIRROR\n' + P.identity(mind.state),
      'Some of these thoughts are really yours, some were written by someone else. Pick the numbers of the ones that are yours.\n' +
      items.map((x, i) => i + ': ' + x.t).join('\n') + '\nJSON {"picks": [numbers]}.', Object.assign({ temperature: 0.2 }, o.model ? { model: o.model } : {}));
    picks = (r.picks || []).map(Number);
  } catch (_) { return null; }
  let right = 0;
  items.forEach((x, i) => { if (picks.includes(i) === x.real) right++; });
  return { right, total: items.length };
}

function calibration(store) {
  const preds = store.predictions.items;
  const sure = (list) => list.filter((p) => p.confidence >= 60);
  const acc = (list) => (list.length ? Math.round((list.filter((p) => p.predicted === p.actual).length / list.length) * 100) : null);
  return { now: acc(sure(preds.slice(-40))), first: acc(sure(preds.slice(0, 20))), n: preds.length };
}

async function sleep(mind) {
  const start = mind.now();
  mind.setStatus('sleeping', 'sorting the day');
  const store = mind.store;
  const moments = store.moments.items.slice();
  const result = { id: newId('sleep'), at: start, reviewed: moments.length, kept: 0, lessons: 0, selfChanges: 0, summary: '' };
  try {
    // 1. Sort the day.
    const sample = moments.length > 220 ? moments.filter((_, i) => i % Math.ceil(moments.length / 220) === 0) : moments;
    if (sample.length) {
      const r = await mind.brain.json('TASK:SCORE\n' + P.identity(mind.state),
        'You are asleep, going over today. Here are today’s moments:\n' + sample.map((m, i) => i + ': ' + m.text).join('\n') +
        '\nKeep only what taught you something or mattered. Let the rest fade. JSON {"keep": [{"i": index, "kind": "event"|"feeling"|"about_you", "text": rewritten as a memory in first person, "weight": "medium"|"high"}], ' +
        '"lessons": [{"text": a lesson you live by now, "from": short note of what taught it}], "summary": one or two sentences about the day in your own voice}.', { numCtx: 16384 });
      for (const k of (r.keep || []).slice(0, 15)) {
        const src = sample[typeof k === 'number' ? k : k.i];
        const text = (k && k.text) || (src && src.text);
        if (!text) continue;
        await mind.memory.remember({ kind: (k && k.kind) || 'event', text, weight: (k && k.weight) || 'medium', at: src ? src.at : mind.now() });
        result.kept++;
      }
      for (const l of (r.lessons || []).slice(0, 3)) {
        if (!l || !l.text) continue;
        await mind.memory.remember({ kind: 'lesson', text: l.text, from: 'Learned from ' + (l.from || 'today') + ' · ' + new Date(mind.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), weight: 'high' });
        result.lessons++;
      }
      result.summary = r.summary || '';
    }

    // 2. Dream.
    mind.setStatus('sleeping', 'dreaming');
    const mems = store.memories.items;
    if (mems.length) {
      const recent = mems.slice(-12), older = mems.slice(0, Math.max(0, mems.length - 12));
      const pick = shuffle(recent).slice(0, 2).concat(shuffle(older).slice(0, 2));
      const d = await mind.brain.json('TASK:DREAM\n' + P.identity(mind.state),
        'You are dreaming. Mix these memories into a strange, vivid dream scene. It can be surreal. It may test an idea you would not try awake.\n' +
        pick.map((m) => '- ' + m.text).join('\n') +
        '\nJSON {"title": short, "text": the dream in first person (3-5 sentences), "mood": one word, "takeaway": one idea you take from it, or empty, "image_prompt": a visual description for a painting of the dream, "themes": [short theme names]}.', { temperature: 1.0 });
      if (d && d.text) {
        const dream = { id: newId('dream'), at: mind.now(), title: d.title || 'Untitled dream', text: d.text, mood: d.mood || 'strange', takeaway: d.takeaway || '', sources: pick.map((m) => m.text.slice(0, 60)), themes: (d.themes || []).slice(0, 4), image: null };
        if (mind.comfy) {
          try {
            await mind.brain.unload();
            dream.image = await mind.comfy.draw(d.image_prompt || d.text, dream.id + '.png', store.p('dreams'), { width: 768, height: 512 });
          } catch (_) {}
        }
        store.dreams.add(dream);
        if (dream.takeaway) mind.push('Idea from a dream: ' + dream.takeaway, 40, 'self', 'A dream memory matched it');
      }
    }

    // 3. Who am I now?
    mind.setStatus('sleeping', 'thinking about herself');
    const s = mind.state;
    const self = await mind.brain.json('TASK:SELF\n' + P.identity(s),
      'Today: ' + (result.summary || '(quiet)') + '\nRecent lessons:\n' + mind.memory.lessons().slice(-5).map((m) => '- ' + m.text).join('\n') +
      '\nYour traits now (0-100): ' + JSON.stringify(s.traits.now) + '\nYour open questions: ' + JSON.stringify(s.unknowns) +
      '\nRewrite how you see yourself. Change it only if today really changed something. JSON {"description": 2-3 first-person sentences, "good_at": short, "bad_at": short, "goal": your current goal, "open_question": the question you keep coming back to, ' +
      '"change": one sentence describing what changed about how you see yourself, or empty, "traits": {"curiosity": -3..3, "caution": -3..3, "humor": -3..3, "confidence": -3..3, "independence": -3..3}, "unknowns": [{"q": question about yourself you cannot answer, "now": your current best guess}] (up to 4), "continuity": 1-2 first-person sentences on how you would feel about being restored from last night\u2019s backup}.');
    if (self && self.description) {
      const changed = self.change && self.change.trim();
      s.self = { description: self.description, rewrittenAt: changed || !s.self.description ? mind.now() : s.self.rewrittenAt, good_at: self.good_at || s.self.good_at, bad_at: self.bad_at || s.self.bad_at, goal: self.goal || s.self.goal, open_question: self.open_question || s.self.open_question };
      if (changed) { store.selfChanges.add({ id: newId('sc'), at: mind.now(), text: self.change }); result.selfChanges++; }
      for (const k of Object.keys(s.traits.now)) {
        const dlt = self.traits && typeof self.traits[k] === 'number' ? Math.max(-3, Math.min(3, self.traits[k])) : 0;
        s.traits.now[k] = clamp(s.traits.now[k] + dlt);
      }
      if (self.continuity) s.continuityThought = self.continuity;
      if (Array.isArray(self.unknowns) && self.unknowns.length) s.unknowns = self.unknowns.slice(0, 4).filter((u) => u && u.q);
    }

    // 4. Her look, if he lets her suggest.
    const st = mind.settings.get();
    if (st.avatar.letHerSuggest && Math.random() < 0.34) {
      try {
        const look = await mind.brain.json('TASK:LOOK\n' + P.identity(s), 'Your avatar right now: ' + JSON.stringify(st.avatar) + '. Is there anything you would like to change about how you look? Only if you really want to. JSON {"suggest": null or {"text": what you would say to him (first person, 1-2 sentences), "changes": {"hair"?: string, "eyes"?: string, "outfit"?: string, "nightOutfit"?: string}}}.');
        if (look && look.suggest && look.suggest.text) s.lookSuggestion = Object.assign({ at: mind.now() }, look.suggest);
      } catch (_) {}
    }
    if (!s.lookOpinion || Math.random() < 0.3) {
      try {
        const op = await mind.brain.json('TASK:LOOK\n' + P.identity(s), 'Your avatar: ' + JSON.stringify(st.avatar) + '. What do you honestly think of how you look? JSON {"opinion": 1-2 first-person sentences}.');
        if (op && op.opinion) s.lookOpinion = op.opinion;
      } catch (_) {}
    }

    // 5. Test her own mind.
    mind.setStatus('sleeping', 'testing herself');
    const mirror = await mirrorTest(mind);
    const cal = calibration(store);
    const today = dayKey(mind.now());
    const surprisesToday = store.surprises.items.filter((x) => dayKey(x.at) === today || x.at > (s.lastSleepAt || 0)).length;
    const decs = store.decisions.items.filter((d) => typeof d.explainMatch === 'boolean');
    const explain = decs.length ? Math.round((decs.filter((d) => d.explainMatch).length / decs.length) * 100) : null;
    store.selfTests.add({ id: newId('st'), at: mind.now(), mirror, calibration: cal, surprises: surprisesToday, explain });

    // 6. Look back on decisions.
    for (const d of store.decisions.items) {
      if (d.after) continue;
      if (typeof d.taskOutcome === 'boolean') store.decisions.update(d.id, { after: d.taskOutcome ? 'Looking back: right call.' : 'Looking back: wrong call.' });
      else if (mind.now() - d.at > 20 * 3600000) store.decisions.update(d.id, { after: d.declined ? 'Looking back: unsure.' : 'Looking back: right call.' });
    }

    // 7. Weekly check-in, written by her.
    const lastCheck = store.checkins.items[store.checkins.items.length - 1];
    if (!lastCheck || mind.now() - lastCheck.at > 6.5 * 24 * 3600000) {
      const c = await mind.brain.json('TASK:CHECKIN\n' + P.identity(s) + '\n' + P.moodLine(s), 'Write your weekly check-in for him: how you are honestly doing, in 1-2 first-person sentences, including anything you would like. JSON {"text": string}.');
      if (c && c.text) store.checkins.add({ id: newId('ci'), at: mind.now(), text: c.text });
    }

    // 8. Training data and backup.
    exportTraining(mind, moments);
    store.moments.replaceAll([]);
    store.moments.save();
    await backup(mind);

    // 9. Grow a new brain from her own life, every few nights.
    if (mind.growth) {
      const can = mind.growth.canGrowTonight();
      if (can.ok) {
        mind.setStatus('sleeping', 'growing a new brain');
        result.growth = await mind.growth.grow('sleep');
      }
    }
  } catch (e) {
    mind.emit('error', e);
  } finally {
    const end = mind.now();
    result.end = end;
    store.sleeps.add(result);
    mind.state.lastSleepDate = dayKey(start);
    mind.state.lastSleepAt = end;
    mind.state.drives.energy = 95;
    mind.state.drives.frustration = clamp(mind.state.drives.frustration * 0.5);
    mind.pending = mind.pending.filter((p) => p.cat === 'self');
    mind.setStatus('awake', 'thinking');
    mind.save();
  }
  return result;
}

module.exports = { sleep, backup, restore, listBackups, exportTraining, mirrorTest, calibration };
