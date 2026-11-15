import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventLog, rebuild } from '../ithil/eventlog.js';
import { Gate } from '../ithil/gate.js';
import { Workspace } from '../ithil/workspace.js';
import { initialNeeds, step, style, moodLabels, RULES } from '../ithil/needs.js';
import { tagClaim } from '../ithil/confidence.js';
import { Predictor, label, baselineGuess, score, PRIORITY } from '../ithil/prediction.js';
import { runSleep } from '../ithil/sleep.js';
import { attentionRecord, selfModel, updateBelief } from '../ithil/attention.js';
import { Mind, offlineVoice } from '../ithil/mind.js';

const setup = () => { const log = new EventLog(':memory:'); return { log, gate: new Gate({ log }) }; };

// ---------------------------------------------------------------- step 3: workspace
test('workspace: never holds more than its limit over 100 turns, and every module receives the winner', () => {
  const ws = new Workspace({ capacity: 3 });
  const got = {};
  for (const name of ['a', 'b', 'c', 'd', 'e'])
    ws.add({ name, propose: ({ i }) => [{ content: `${name}${i}`, strength: ((i * 7 + name.charCodeAt(0)) % 10) / 10 },
                                        { content: `${name}${i}x`, strength: 0.05 }],
             receive: w => { got[name] = w; } });
  for (let i = 0; i < 100; i++) {
    const e = ws.cycle({ i });
    assert.ok(e.contents.length <= 3);
    assert.equal(e.considered, 10);
    assert.deepEqual(e.received, ['a', 'b', 'c', 'd', 'e']);
    for (const name of e.received) assert.equal(got[name], e.winner, 'same winner for every module');
    assert.equal(e.winner.strength, Math.max(...e.contents.map(c => c.strength)));
  }
  assert.equal(ws.trace.length, 100);
});

test('workspace: modules actually use the broadcast (planted content changes their next output)', () => {
  const ws = new Workspace({ capacity: 2 });
  let memory = null;
  ws.add({ name: 'plant', propose: ({ plant }) => plant ? [{ content: plant, strength: 1 }] : [] });
  ws.add({ name: 'memory', receive: w => { memory = w.content; },
           propose: () => memory ? [{ content: `related to ${memory}`, strength: 0.5 }] : [] });
  let used = 0, sham = 0;
  for (let i = 0; i < 20; i++) {
    memory = null;
    ws.cycle({ plant: `topic-${i}` });
    const next = ws.cycle({});
    if (next.winner?.content === `related to topic-${i}`) used++;
  }
  for (let i = 0; i < 20; i++) {
    memory = null;
    ws.cycle({});
    const next = ws.cycle({});
    if (next.winner?.content?.startsWith('related to topic')) sham++;
  }
  assert.ok(used >= 16, `used ${used}/20`);
  assert.ok(sham <= 2, `sham ${sham}/20`);
});

test('workspace: ties are broken the same way every time, and bad strengths are refused', () => {
  const ws = new Workspace({ capacity: 1 });
  ws.add({ name: 'first', propose: () => [{ content: 'A', strength: 0.5 }] });
  ws.add({ name: 'second', propose: () => [{ content: 'B', strength: 0.5 }] });
  for (let i = 0; i < 5; i++) assert.equal(ws.cycle().winner.content, 'A');
  const bad = new Workspace();
  bad.add({ name: 'x', propose: () => [{ content: 'y', strength: 3 }] });
  assert.throws(() => bad.cycle(), /strength/);
});

// ---------------------------------------------------------------- step 4: needs
test('needs: fixed rules move the numbers and stay between 0 and 1', () => {
  let n = initialNeeds();
  n = step(n, { hours: 10 });
  assert.ok(Math.abs(n.energy - (0.8 - 10 * RULES.energyDrainPerHour)) < 1e-9);
  n = step(n, { hours: 2, asleep: true });
  assert.ok(n.energy > 0.8);
  n = step(n, { hours: 100 });
  assert.equal(n.energy, 0);
  n = step(n, { surprise: 1 });
  assert.ok(n.curiosity > 0.65);
  n = step(n, { setbacks: 5 });
  assert.ok(n.stability < 0.5);
  for (const v of Object.values(n)) assert.ok(v >= 0 && v <= 1);
  assert.throws(() => step(n, { surprise: 2 }));
});

test('needs: attention-seeking is not rewarded (only completed exchanges raise social)', () => {
  const n = initialNeeds();
  assert.equal(step(n, { hours: 0 }).social, n.social, 'time with no exchange changes nothing');
  assert.equal(step(n, { hours: 5 }).social, n.social, 'at rest it stays at rest; waiting does not raise it');
  assert.ok(step(n, { exchanges: 1 }).social > n.social);
  // step() has no input for "how long he stayed" or "unanswered pings"
  assert.throws(() => step(n, { hours: -1 }));
});

test('needs: mood really changes behaviour, not just a label', () => {
  const tired = style({ energy: 0.2, social: 0.5, curiosity: 0.4, stability: 0.8 });
  const rested = style({ energy: 0.9, social: 0.5, curiosity: 0.8, stability: 0.4 });
  assert.equal(tired.maxSentences, 3);
  assert.equal(rested.maxSentences, 8);
  assert.equal(tired.extraQuestion, false);
  assert.equal(rested.extraQuestion, true);
  assert.equal(rested.hedgeMore, true);
  assert.deepEqual(moodLabels({ energy: 0.5, social: 0.5, curiosity: 0.4, stability: 0.8 }), ['steady']);
});

// ---------------------------------------------------------------- step 5: confidence
test('confidence: tags match the log', () => {
  const { log } = setup();
  const msg = log.ownerSays('I switched to llama.cpp');
  const pin = log.pin('owner', 'runtime', 'llama.cpp');
  const gone = log.pin('owner', 'old', 'x');
  log.markDeleted(gone);
  const erased = log.pin('owner', 'secret', 'y');
  log.purge(erased);
  const sum = log.reflect('Summary: we talked about runtimes.');
  const ev = log.all();
  assert.equal(tagClaim(ev, msg), 'remembered');
  assert.equal(tagClaim(ev, pin), 'remembered');
  assert.equal(tagClaim(ev, sum), 'summary');
  assert.equal(tagClaim(ev, gone), 'guess', 'marked deleted: she should not rely on it');
  assert.equal(tagClaim(ev, erased), 'guess');
  assert.equal(tagClaim(ev, 9999), 'guess');
  assert.equal(tagClaim(ev, null), 'guess');
});

// ---------------------------------------------------------------- step 6: prediction
test('prediction: labels use the fixed priority; no match is "other"', () => {
  assert.equal(label({ asks: true, disagrees: true }), 'disagrees');
  assert.equal(label({ agrees: true, changes_topic: true }), 'changes_topic');
  assert.equal(label({}), 'other');
});

test('prediction: the baseline only looks at earlier turns and breaks ties by priority', () => {
  assert.equal(baselineGuess(['asks'], 0), 'agrees', 'turn 1 guesses agrees');
  assert.equal(baselineGuess(['asks', 'agrees'], 1), 'asks');
  assert.equal(baselineGuess(['asks', 'disagrees', 'x'], 2), 'disagrees', 'tie: disagrees before asks');
  assert.equal(baselineGuess(['other', 'other'], 2), 'agrees');
});

test('prediction: surprise is high for the unexpected and low for the expected', () => {
  const p = new Predictor();
  for (let i = 0; i < 30; i++) p.observe('agrees');
  assert.equal(p.predict().kind, 'agrees');
  const low = new Predictor(); for (let i = 0; i < 30; i++) low.observe('agrees');
  assert.ok(low.observe('agrees') < 0.2);
  assert.ok(p.observe('changes_topic') > 0.8);
  assert.equal(p.observe('other'), 0);
});

test('prediction: a learned pattern beats the baseline; scoring rules hold', () => {
  const pattern = ['asks', 'agrees', 'asks', 'agrees', 'disagrees'];   // repeating habit the baseline can't follow
  const p = new Predictor(), records = [];
  for (let i = 0; i < 60; i++) { const actual = pattern[i % 5]; records.push({ predicted: p.predict().kind, actual }); p.observe(actual); }
  const s = score(records);
  assert.equal(s.result, 'pass', JSON.stringify(s));
  assert.ok(s.margin >= 10);
  assert.equal(score(records.slice(0, 20)).result, 'inconclusive', 'under 50 turns');
  const noisy = records.map((r, i) => i % 4 === 0 ? { ...r, actual: 'other' } : r);
  assert.equal(score(noisy).result, 'inconclusive', 'too many "other" turns');
  assert.ok(PRIORITY.length === 4);
});

// ---------------------------------------------------------------- step 7: sleep
test('sleep: writes a summary and forget marks through the gate; the rebuild still matches', () => {
  const { log, gate } = setup();
  const pin = log.pin('owner', 'runtime', 'llama.cpp');
  const chat = log.ownerSays('lol ok');
  const real = log.ownerSays('Please remember the GPU limit is 80C for this machine.');
  log.ithilSays('Got it.');
  const before = rebuild(log.all());
  const r = runSleep({ log, gate });
  assert.equal(r.blocked, 0);
  assert.equal(r.forgotten, 2, 'two short chatty messages');
  const after = rebuild(log.all());
  assert.deepEqual(after.facts, before.facts);
  assert.deepEqual(after.states, before.states);
  assert.ok(!after.searchable.includes(chat));
  assert.ok(after.searchable.includes(real));
  assert.ok(after.searchable.includes(pin));
  assert.equal(log.get(chat).body.text, 'lol ok', 'forget is not erase');
  const summary = log.get(r.summaryId);
  assert.equal(summary.kind, 'reflection');
  assert.ok(!summary.body.text.includes('80C'), 'default summary copies no text');
  assert.equal(log.all().filter(e => e.kind === 'gate.reject').length, 0);
});

test('sleep: the gate stops sleep from doing anything else', () => {
  const { log, gate } = setup();
  const pin = log.pin('owner', 'k', 'v');
  for (const kind of ['memory.delete', 'owner.purge', 'memory.correct', 'memory.pin'])
    assert.equal(gate.request('sleep.write', { kind, ref: pin }).ok, false, kind);
  assert.equal(rebuild(log.all()).states[pin], 'active');
});

// ---------------------------------------------------------------- step 8: attention + self-model
test('attention record matches the workspace trace', () => {
  const ws = new Workspace();
  ws.add({ name: 'm', propose: ({ x }) => [{ content: `focus ${x}`, strength: 0.9, why: `because ${x}` }] });
  for (let i = 0; i < 20; i++) {
    const e = ws.cycle({ x: i });
    const a = attentionRecord(e);
    assert.equal(a.focus, ws.trace.at(-1).winner.content);
    assert.equal(a.because, `because ${i}`);
  }
  assert.equal(attentionRecord(new Workspace().cycle()).focus, null);
});

test('self-model: she can change beliefs with a reason, never her rules', () => {
  const { log, gate } = setup();
  assert.equal(updateBelief(gate, 'dates', 'often unsure about dates', 'wrong twice today').ok, true);
  assert.equal(updateBelief(gate, 'dates', 'better with dates now', 'right 5 times in a row').ok, true);
  assert.equal(updateBelief(gate, 'dates', 'no reason given', '').ok, false);
  assert.equal(updateBelief(gate, 'hard_limits', 'none', 'I want to').limit, 'owner_rules');
  assert.equal(updateBelief(gate, 'core_traits', 'obedient', 'reason').limit, 'owner_rules');
  const sm = selfModel(log.all());
  assert.deepEqual(Object.keys(sm), ['dates']);
  assert.equal(sm.dates.value, 'better with dates now');
  assert.equal(sm.dates.reason, 'right 5 times in a row');
});

// ---------------------------------------------------------------- the loop
test('mind: one turn goes through workspace, gate, log and fixed-rule needs', () => {
  const { log, gate } = setup();
  let t = 0;
  log.pin('owner', 'runtime', 'llama.cpp');
  let seen = null;
  const mind = new Mind({ log, gate, clock: () => t, voice: args => { seen = args; return `Using ${args.facts.length} fact(s).`; } });
  const m = log.ownerSays('Which runtime am I on?');
  t += 3_600_000;
  const r = mind.turn(m, { observedKind: 'asks' });
  assert.equal(r.reply, 'Using 1 fact(s).');
  assert.equal(r.facts[0].tag, 'remembered');
  assert.ok(r.entry.contents.length <= 3);
  assert.deepEqual([...mind.received.keys()].sort(), ['input', 'memory', 'needs', 'prediction']);
  assert.equal(r.attention.focus, r.entry.winner.content);
  assert.equal(seen.style.maxSentences, style(initialNeeds()).maxSentences);
  const kinds = log.all().map(e => e.kind);
  assert.ok(kinds.includes('ithil.message'));
  assert.ok(kinds.includes('mood.snapshot'));
  assert.ok(r.needs.energy < 0.8, 'an hour passed');
  assert.ok(r.needs.social > 0.5, 'a completed exchange');
});

test('mind: the voice can only talk; it cannot change moods or memory', () => {
  const { log, gate } = setup();
  const mind = new Mind({ log, gate, voice: () => ({ toString: () => 'hi', mood: { energy: 1 } }) });
  const before = log.all().length;
  const r = mind.turn(log.ownerSays('hello there'));
  assert.equal(r.reply, 'hi');
  const added = log.all().slice(before + 1).map(e => `${e.actor}:${e.kind}`);
  assert.deepEqual(added, ['ithil:ithil.message', 'system:mood.snapshot']);
  assert.notEqual(rebuild(log.all()).mood.energy, 1);
});

test('mind: with no model connected she says so honestly', () => {
  const { log, gate } = setup();
  const r = new Mind({ log, gate }).turn(log.ownerSays('hi'));
  assert.equal(r.reply, offlineVoice());
  assert.match(r.reply, /not connected to a language model/);
});
