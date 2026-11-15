'use strict';
// 0.6: the team's core mind running in her real mind, signed settings, and the Tests screen's checks.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../src/main/mind/store');
const { Settings } = require('../src/main/mind/settings');
const { Rules } = require('../src/main/mind/rules');
const { FakeBrain } = require('../src/main/mind/llm');
const { Mind } = require('../src/main/mind/engine');
const { Journal } = require('../src/main/core/journal');
const { Live, labelReply } = require('../src/main/core/live');
const { SignedSettings } = require('../src/main/core/owner');
const selftest = require('../src/main/core/selftest');

function setup(now) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ithil-live-'));
  const store = new Store(dir);
  const settings = new Settings(store);
  const journal = new Journal(dir);
  const live = new Live({ journal, now });
  const rules = new Rules(store); rules.useSettings(() => settings.get());
  const mind = new Mind({ store, brain: new FakeBrain(), settings, rules, body: null, journal, live });
  return { dir, store, settings, journal, live, rules, mind };
}

test('his replies are labelled by what they say', () => {
  assert.equal(labelReply('What do you remember?'), 'asks');
  assert.equal(labelReply('No, that is wrong'), 'disagrees');
  assert.equal(labelReply('yeah sounds good'), 'agrees');
  assert.equal(labelReply('hmm'), 'other');
});

test('talking runs the workspace, tags her claims and moves her needs by the fixed rules', async () => {
  let t = Date.parse('2026-11-15T03:00:00Z');
  const { dir, store, journal, live, mind } = setup(() => t);
  try {
    await mind.memory.remember({ kind: 'about_you', text: 'He works the overnight shift at the plant', source: 'msg_x' });
    const before = Object.assign({}, live.needs);
    t += 3600000;
    await mind.talk('Do you remember what shift I work?');
    const e = live.lastEntry;
    assert.ok(e && e.winner, 'the workspace ran');
    assert.ok(e.contents.length <= 4);
    assert.ok(live.focus.focus);
    assert.ok(live.needs.energy < before.energy, 'an hour awake drains energy');
    const reply = store.chat.items.filter((m) => m.role === 'ithil').pop();
    assert.ok(Array.isArray(reply.tags));
    assert.ok(reply.event, 'her reply points at its log entry');
    assert.ok(journal.log.all().some((x) => x.kind === 'mood.snapshot'), 'needs are kept in the log');
    const v = live.view({ store, settings: mind.settings.get(), mind });
    assert.ok(v.workspace.length && v.workspace[0].won);
    assert.ok(v.history.length >= 1);
    assert.equal(typeof v.memory.stats.events, 'number');
    assert.ok(v.gate.limits.find((l) => l.code === 'version_numbers'));
  } finally { journal.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('needs come back after a restart', () => {
  let t = Date.now();
  const { dir, journal, live } = setup(() => t);
  t += 10 * 3600000; live.tick(false); live.snapshot(true);
  const n = Object.assign({}, live.needs);
  journal.close();
  const j2 = new Journal(dir);
  const l2 = new Live({ journal: j2, now: () => t });
  for (const k of Object.keys(n)) assert.ok(Math.abs(l2.needs[k] - n[k]) < 0.01, k);
  j2.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('tired Ithil is told to answer shorter (needs change behaviour, not just a label)', () => {
  let t = Date.now();
  const { dir, journal, live } = setup(() => t);
  t += 16 * 3600000; live.tick(false);
  assert.match(live.styleLine(), /at most 3 sentences/);
  journal.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('a blocked action shows in the chat and dips her stability', async () => {
  const { dir, store, journal, live, mind } = setup(() => Date.now());
  const s0 = live.needs.stability;
  const ws = path.join(dir, 'workspace');
  const r = await mind.tools.run({ type: 'write_file', path: path.join(ws, 'package.json'), content: '{"version":"9.9.9"}' }, ws);
  // a new package.json is fine; changing an existing one's version is not
  fs.writeFileSync(path.join(ws, 'package.json'), '{"version":"1.0.0"}');
  const r2 = await mind.tools.run({ type: 'write_file', path: path.join(ws, 'package.json'), content: '{"version":"9.9.9"}' }, ws);
  assert.equal(r2.blocked, true); assert.equal(r2.code, 'version_numbers');
  const g = store.chat.items.filter((m) => m.role === 'gate').pop();
  assert.equal(g.limit, 'version_numbers');
  assert.ok(live.needs.stability < s0);
  assert.ok(r.ok || r.blocked);
  journal.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('quiet hours and messages-first limit', () => {
  const { dir, journal, settings, mind } = setup(() => Date.now());
  settings.setByUser({ quietHours: '00:00-23:59', messagesFirstPerDay: 1 });
  assert.equal(mind.canMessageFirst(), false, 'quiet hours');
  settings.setByUser({ quietHours: '' });
  assert.equal(mind.canMessageFirst(), true);
  mind.store.chat.add({ id: 'u1', at: Date.now(), role: 'ithil', text: 'hi', unprompted: true });
  assert.equal(mind.canMessageFirst(), false, 'already messaged first today');
  journal.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('pushes go only to the branch he signed, as HEAD:branch', () => {
  const { dir, journal, settings, rules, store } = setup(() => Date.now());
  const ws = path.join(store.dir, 'workspace');
  assert.equal(rules.check({ type: 'git', args: ['push', 'origin', 'HEAD:mind/x'], cwd: ws }).ok, false);
  settings.setByUser({ pushBranch: 'mind/x' });
  assert.equal(rules.check({ type: 'git', args: ['push', 'origin', 'HEAD:mind/x'], cwd: ws }).ok, true);
  assert.equal(rules.check({ type: 'git', args: ['push', 'origin', 'HEAD:main'], cwd: ws }).ok, false);
  assert.equal(rules.check({ type: 'git', args: ['push', '--tags'], cwd: ws }).ok, false);
  settings.setByUser({ pushBranch: 'main' });
  assert.equal(rules.check({ type: 'git', args: ['push', 'origin', 'HEAD:main'], cwd: ws }).ok, false, 'never main');
  settings.setByUser({ protectedPaths: path.join(ws, 'keep') });
  assert.equal(rules.check({ type: 'write_file', path: path.join(ws, 'keep', 'a.txt'), content: 'x' }).ok, false, 'his extra protected paths');
  journal.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('signed settings: applied once, a replay is refused, unsigned changes are refused', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ithil-signed-'));
  const journal = new Journal(dir);
  const applied = [];
  const ss = new SignedSettings({ journal, dir, apply: (k, v) => applied.push([k, v]) });
  assert.equal(ss.ok, true, ss.why);
  const r = ss.change('quietHours', '23:00-08:00', 'quietHours → 23:00-08:00');
  assert.equal(r.ok, true); assert.equal(r.signed, true);
  assert.deepEqual(applied, [['quietHours', '23:00-08:00']]);
  const cmd = journal.log.all().find((e) => e.kind === 'owner.message' && e.body.command);
  assert.equal(ss.replay(cmd.id).ok, false, 'replay refused');
  assert.equal(applied.length, 1);
  // a forged command (no valid signature) is refused
  const forged = journal.log.ownerCommand('x', { type: 'settings', key: 'pushBranch', value: 'main', nonce: 'aaaaaaaaaaaaaaaaaaaa' }, 'bm90IGEgc2lnbmF0dXJl');
  assert.equal(ss.gate.request('settings.write', { ownerEventId: forged, key: 'pushBranch', value: 'main' }).ok, false);
  assert.equal(applied.length, 1);
  assert.equal((fs.statSync(path.join(dir, 'owner', 'owner-key.pem')).mode & 0o777), 0o600, 'his key is readable only by him');
  journal.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('every mechanism check on the Tests screen passes', () => {
  for (const name of Object.keys(selftest.MECHANISMS)) {
    const r = selftest.runMechanism(name);
    assert.equal(r.passed, r.total, name + ': ' + JSON.stringify(r.failed));
  }
});

test('behaviour tests run on a copy of her log and never touch the real one', async () => {
  const { dir, journal, live, mind, store } = setup(() => Date.now());
  await mind.memory.remember({ kind: 'about_you', text: 'He likes Battle for Middle-earth' });
  const before = journal.log.all().length, chats = store.chat.items.length;
  for (const k of ['s1', 's2', 's3', 's4']) {
    const r = await selftest.runBehaviour(k, { mind, live, journal });
    assert.equal(typeof r.passed, 'number', k);
    assert.ok(r.showed, k);
  }
  assert.equal(journal.log.all().length, before, 'her real log is unchanged');
  assert.equal(store.chat.items.length, chats, 'nothing was said in her chat');
  journal.close(); fs.rmSync(dir, { recursive: true, force: true });
});
