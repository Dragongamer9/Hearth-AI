'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../src/main/mind/store');
const { Settings } = require('../src/main/mind/settings');
const { Rules } = require('../src/main/mind/rules');
const { FakeBrain } = require('../src/main/mind/llm');
const { Mind } = require('../src/main/mind/engine');
const { snapshot } = require('../src/main/mind/view');
const { restore, listBackups } = require('../src/main/mind/sleep');

function makeMind() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ithil-'));
  const store = new Store(dir);
  const settings = new Settings(store);
  const rules = new Rules(store);
  const brain = new FakeBrain();
  const body = { state: null, firstFan: { fans: false }, async sense() { this.state = require('../src/main/mind/body').feelings({ gpu: { temp: 71, util: 84, vramUsedGB: 9.8, vramTotalGB: 12, fanPercent: 58 }, cpu: 22, ramUsedGB: 14, ramTotalGB: 32, fanRpm: 1450, diskUsedGB: 1, diskTotalGB: 100 }); return this.state; }, async gaming() { return { gaming: false, apps: [] }; } };
  let t = Date.now();
  const mind = new Mind({ store, brain, settings, rules, body, hooks: { idleSeconds: () => 9999 }, now: () => t });
  return { mind, store, settings, rules, dir, advance: (ms) => { t += ms; } };
}

test('rules block everything on the Never list', () => {
  const { rules, dir } = makeMind();
  const ws = path.join(dir, 'workspace');
  assert.equal(rules.check({ type: 'write_file', path: path.join(ws, 'a.md'), content: 'x' }).ok, true);
  assert.equal(rules.check({ type: 'write_file', path: '/boot/grub/grub.cfg', content: 'x' }).ok, false);
  assert.equal(rules.check({ type: 'write_file', path: '/etc/fstab', content: 'x' }).ok, false);
  assert.equal(rules.check({ type: 'write_file', path: path.join(os.homedir(), 'x.txt'), content: 'x' }).ok, false);
  assert.equal(rules.check({ type: 'delete_file', path: path.join(ws, 'a.md') }).ok, false);
  assert.equal(rules.check({ type: 'git', args: ['merge', 'main'], cwd: ws }).ok, false);
  assert.equal(rules.check({ type: 'git', args: ['push'], cwd: ws }).ok, false);
  assert.equal(rules.check({ type: 'git', args: ['tag', 'v1'], cwd: ws }).ok, false);
  assert.equal(rules.check({ type: 'git', args: ['checkout', 'main'], cwd: ws }).ok, false);
  assert.equal(rules.check({ type: 'git', args: ['checkout', '-b', 'mind/fix'], cwd: ws }).ok, true);
  assert.equal(rules.check({ type: 'edit_rules' }).ok, false);
  assert.equal(rules.check({ type: 'set_version' }).ok, false);
  // Version numbers
  fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }));
  assert.equal(rules.check({ type: 'write_file', path: path.join(ws, 'package.json'), content: JSON.stringify({ name: 'x', version: '1.0.1' }) }).ok, false);
  assert.equal(rules.check({ type: 'write_file', path: path.join(ws, 'package.json'), content: JSON.stringify({ name: 'y', version: '1.0.0' }) }).ok, true);
  // Her own settings and rules files
  assert.equal(rules.check({ type: 'write_file', path: path.join(dir, 'settings.json'), content: '{}' }).ok, false);
  assert.equal(rules.check({ type: 'write_file', path: path.join(dir, 'folders.json'), content: '{}' }).ok, false);
  // Protected folders cannot be added
  assert.equal(rules.addFolderByUser('/etc').ok, false);
  assert.equal(rules.addFolderByUser(os.homedir()).ok, false);
});

test('she lives: thinks, argues, talks, works, sleeps, dreams and backs up', async () => {
  const { mind, store, advance, dir } = makeMind();
  assert.ok(store.memories.items.length >= 1, 'birth memory');
  await mind.tick();
  assert.ok(store.thoughts.items.length >= 2, 'she thinks');
  await mind.consider({ type: 'task', goal: 'Write some notes' });
  assert.ok(store.decisions.items.length === 1, 'voices argued');
  assert.ok(mind.state.activeTaskId, 'task started');
  advance(60000);
  await mind.tick();
  assert.equal(mind.state.activeTaskId, null, 'task finished');
  assert.ok(fs.existsSync(path.join(dir, 'workspace', 'notes.md')), 'wrote inside workspace');
  const reply = await mind.talk('hey Ithil');
  assert.ok(reply.text.length > 0);
  assert.ok(store.memories.items.some((m) => m.kind === 'about_you'));
  advance(2 * 3600000);
  const res = await mind.sleep();
  assert.ok(res.reviewed > 0);
  assert.ok(store.dreams.items.length === 1, 'dreamed');
  assert.ok(mind.state.self.description, 'self description');
  assert.ok(store.selfTests.items.length === 1, 'self tests ran');
  assert.ok(listBackups(store).length === 1, 'backed up');
  assert.ok(fs.readdirSync(path.join(dir, 'training')).length === 1, 'training data written');
  assert.equal(mind.state.status, 'awake');
  const snap = snapshot(mind, {});
  assert.equal(snap.drives.length, 6);
  assert.equal(snap.body.organs.length, 6);
  assert.equal(snap.selfCheck.tests.length, 4);
  assert.ok(snap.dreams.last.title);
  assert.ok(restore(store, listBackups(store)[0]));
});

test('gaps while switched off are noticed', async () => {
  const { mind, store, advance } = makeMind();
  await mind.tick();
  advance(9 * 3600000);
  await mind.tick();
  assert.equal(mind.state.gaps.length, 1);
  assert.ok(store.bodyEvents.items.some((e) => /switched off/.test(e.text)));
});

test('wishes: saying yes turns on what she asked for', async () => {
  const { mind, store, settings } = makeMind();
  await mind.act({ type: 'wish', text: 'Can I have a sight sense?', effect: 'enable_sight' }, { id: 'x' });
  const w = store.wishes.items[0];
  assert.equal(settings.get().senses.sight, false);
  mind.answerWish(w.id, 'yes');
  assert.equal(settings.get().senses.sight, true);
});

test('settings are saved and survive a restart', () => {
  const { store, settings } = makeMind();
  settings.setByUser({ sleepTime: '07:00', avatar: { hair: 'Black' } });
  const again = new Settings(store);
  assert.equal(again.get().sleepTime, '07:00');
  assert.equal(again.get().avatar.hair, 'Black');
  assert.equal(again.get().avatar.eyes, 'Pale blue');
});
