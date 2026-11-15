'use strict';
// 0.5: the team's event log, wired into her real app.
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
const { rebuild } = require('../src/main/core/eventlog');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ithil-journal-'));
  const store = new Store(dir);
  const settings = new Settings(store);
  const journal = new Journal(dir);
  const mind = new Mind({ store, brain: new FakeBrain(), settings, rules: new Rules(store), body: null, journal });
  return { dir, store, mind, journal };
}

test('talking, memories and blocked actions all land in her event log', async () => {
  const { dir, mind, journal } = setup();
  try {
    assert.equal(journal.ok, true, journal.why);
    await mind.talk('Hi Ithil, how was your night?');
    await mind.talk('Hello from the team', { from: 'Claude' });
    const kinds = journal.log.all().map((e) => `${e.actor}:${e.kind}`);
    assert.ok(kinds.includes('owner:owner.message'), kinds.join(' '));
    assert.ok(kinds.includes('ithil:ithil.message'));
    assert.ok(journal.log.all().some((e) => e.kind === 'system.input' && e.body.from === 'Claude'), 'a teammate is not him');

    const m = await mind.memory.remember({ kind: 'about_you', text: 'He works overnight' });
    assert.equal(rebuild(journal.log.all()).facts['mem:' + m.id].value, 'He works overnight');
    mind.memory.edit(m.id, 'He works the overnight shift');
    assert.equal(rebuild(journal.log.all()).facts['mem:' + m.id].value, 'He works the overnight shift');
    mind.memory.forget(m.id);
    assert.ok(!JSON.stringify(journal.log.all()).includes('overnight'), 'his Forget wipes the words from the log too');

    const ws = path.join(dir, 'workspace');
    const r1 = await mind.tools.run({ type: 'git', args: ['-c', 'core.pager=rm -rf ~', 'log'], cwd: ws }, ws);
    const r2 = await mind.tools.run({ type: 'write_file', path: path.join(ws, 'repo', '.git', 'hooks', 'pre-commit'), content: 'x' }, ws);
    const r3 = await mind.tools.run({ type: 'git', args: ['diff', '--output=' + path.join(os.homedir(), 'x.txt')], cwd: ws }, ws);
    for (const r of [r1, r2, r3]) assert.equal(r.blocked, true);
    assert.ok(journal.log.all().filter((e) => e.kind === 'gate.reject').length >= 3);
  } finally { journal.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a pin made for a memory is found again after a restart', async () => {
  const { dir, mind, journal, store } = setup();
  const m = await mind.memory.remember({ kind: 'about_you', text: 'Likes BFME2' });
  journal.close();
  const j2 = new Journal(dir);
  const mind2 = new Mind({ store, brain: new FakeBrain(), settings: new Settings(store), rules: new Rules(store), body: null, journal: j2 });
  mind2.memory.forget(m.id);
  assert.ok(!JSON.stringify(j2.log.all()).includes('BFME2'));
  j2.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('a damaged log file is kept aside and she still starts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ithil-journal-'));
  fs.writeFileSync(path.join(dir, 'events.db'), 'this is not a database, just junk bytes '.repeat(200));
  const j = new Journal(dir);
  assert.equal(j.ok, true, j.why);
  assert.match(j.why, /kept as events\.db\.unreadable-/);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('events.db.unreadable-')));
  j.close(); fs.rmSync(dir, { recursive: true, force: true });
});
