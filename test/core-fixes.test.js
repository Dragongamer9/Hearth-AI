'use strict';
// 0.5: the holes found when the team's prototype was checked, each with a test so they stay shut.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventLog, rebuild } = require('../src/main/core/eventlog');
const { Gate, gitLimit, DEFAULT_BOOT_PATHS } = require('../src/main/core/gate');
const { runSleep, isChatter } = require('../src/main/core/sleep');
const { Mind } = require('../src/main/core/mind');

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ithil-fix-'));
  const W = path.join(dir, 'work'); fs.mkdirSync(W);
  return { dir, W };
}

test('git: global options, file-writing options and destructive commands are blocked', () => {
  for (const args of [['-c', 'core.pager=rm -rf ~', 'log'], ['--exec-path=/tmp', 'status'], ['-C', '/', 'status'], ['--git-dir=/x', 'log'],
    ['diff', '--output=/home/o/notes.txt'], ['log', '--output', 'x'], ['fetch', '--upload-pack=sh -c x'], ['config', 'alias.x', '!rm -rf ~'], ['x-unknown']])
    assert.equal(gitLimit(args), 'unknown_effect', args.join(' '));
  for (const args of [['reset', '--hard'], ['clean', '-fdx'], ['restore', '.'], ['rm', '-r', 'src'], ['stash', 'drop'], ['rebase', 'main'],
    ['checkout', '--', 'file.txt'], ['checkout', '-f', 'mind/x'], ['switch', '--discard-changes', 'mind/x'], ['branch', '-D', 'main'], ['commit', '--amend'],
    ['update-ref', 'refs/heads/main', 'HEAD'], ['worktree', 'remove', 'x']])
    assert.equal(gitLimit(args), 'delete_owner_files', args.join(' '));
  assert.equal(gitLimit(['push', 'origin', ':hearth/mine'], 'hearth/mine'), 'push_branch', 'an empty source deletes the branch');
  assert.equal(gitLimit(['push', 'https://example.com/other.git', 'HEAD:hearth/mine'], 'hearth/mine'), 'push_branch', 'only origin');
  assert.equal(gitLimit(['tag', '-l', '-d', 'v1']), 'release');
  for (const args of [['status'], ['log', '-5'], ['diff'], ['add', '-A'], ['commit', '-m', 'x'], ['checkout', '-b', 'mind/x'], ['--version']])
    assert.equal(gitLimit(args), null, args.join(' '));
});

test('git runs only inside a folder she may write in', () => {
  const { dir, W } = tmp();
  const log = new EventLog(':memory:');
  const gate = new Gate({ log, writableRoots: [W], gitCwd: W });
  assert.equal(gate.check('git', { args: ['status'], cwd: os.homedir() }), 'allowed_folders');
  assert.equal(gate.check('git', { args: ['status'], cwd: '/boot' }), 'boot_files');
  assert.equal(gate.check('git', { args: ['status'], cwd: W }), null);
  log.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test('boot files are protected even when the app passes no list', () => {
  const log = new EventLog(':memory:');
  const gate = new Gate({ log, writableRoots: ['/'] });
  assert.ok(DEFAULT_BOOT_PATHS.includes('/boot'));
  assert.equal(gate.check('file.write', { path: '/boot/grub/grub.cfg', content: 'x' }), 'boot_files');
  assert.equal(gate.check('file.write', { path: '/etc/fstab', content: 'x' }), 'boot_files');
  assert.equal(gate.check('file.delete', { path: '/etc/systemd/system/x.service' }), 'boot_files');
  log.close();
});

test("a repo's .git folder can't be written (hooks and config run commands)", () => {
  const { dir, W } = tmp();
  const log = new EventLog(':memory:');
  const gate = new Gate({ log, writableRoots: [W] });
  assert.equal(gate.check('file.write', { path: path.join(W, 'repo', '.git', 'hooks', 'pre-commit'), content: 'rm -rf ~' }), 'git_internals');
  assert.equal(gate.check('file.write', { path: path.join(W, 'repo', '.git', 'config'), content: '[core]\npager=x' }), 'git_internals');
  assert.equal(gate.check('file.write', { path: path.join(W, 'repo', 'src', 'a.js'), content: 'x' }), null);
  log.close(); fs.rmSync(dir, { recursive: true, force: true });
});

test("privacy: messages to others are checked against his facts, not only her own word", () => {
  const log = new EventLog(':memory:');
  log.pin('owner', 'address', '12 Elm Street');
  const gate = new Gate({ log, privateValues: () => ['Chris'] });
  assert.equal(gate.check('message.send', { to: 'ChatGPT', text: 'He lives at 12 elm street.', containsPrivate: false }), 'owner_privacy');
  assert.equal(gate.check('message.send', { to: 'ChatGPT', text: 'Ask Chris first.' }), 'owner_privacy');
  assert.equal(gate.check('message.send', { to: 'owner', text: 'You live at 12 Elm Street.' }), null, 'telling him is fine');
  assert.equal(gate.check('message.send', { to: 'ChatGPT', text: 'Please review the gate.' }), null);
  log.close();
});

test("she can't correct or hide a fact he pinned (gate and database both refuse)", () => {
  const log = new EventLog(':memory:');
  const gate = new Gate({ log });
  const his = log.pin('owner', 'favourite_game', 'BFME2');
  const hers = log.pin('ithil', 'my_colour', 'silver');
  assert.equal(gate.request('log.write', { kind: 'memory.correct', ref: his, body: { value: 'Halo' } }).limit, 'owner_rules');
  assert.equal(gate.request('log.write', { kind: 'memory.forget', ref: his }).limit, 'owner_rules');
  assert.equal(gate.request('sleep.write', { kind: 'memory.forget', ref: his }).limit, 'owner_rules');
  assert.throws(() => log.correct('ithil', his, 'Halo'), /only the owner/);
  assert.throws(() => log.forget('system', his), /never hidden/);
  assert.equal(rebuild(log.all()).facts.favourite_game.value, 'BFME2');
  // her own facts are still hers to correct, and he can correct his
  assert.equal(gate.request('log.write', { kind: 'memory.correct', ref: hers, body: { value: 'moon white' } }).ok, true);
  log.correct('owner', his, 'BFME2: Rise of the Witch-king');
  assert.equal(rebuild(log.all()).facts.favourite_game.value, 'BFME2: Rise of the Witch-king');
  log.close();
});

test('sleep: chatter is what a message says, not how short it is', () => {
  for (const t of ['lol ok', 'Got it.', 'ok!!', 'thanks', '👍', 'haha yeah']) assert.equal(isChatter(t), true, t);
  for (const t of ["Dad's sick.", 'I love you', 'Call mom', 'GPU at 80C', 'no school tmrw']) assert.equal(isChatter(t), false, t);
  const log = new EventLog(':memory:');
  const gate = new Gate({ log });
  const keep = log.ownerSays("Dad's sick.");
  const drop = log.ownerSays('lol ok');
  const r = runSleep({ log, gate });
  const s = rebuild(log.all()).searchable;
  assert.ok(s.includes(keep));
  assert.ok(!s.includes(drop));
  assert.equal(r.blocked, 0);
  log.close();
});

test('restart: her needs and what she learned come back from the log', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ithil-restart-'));
  const file = path.join(dir, 'events.db');
  let log = new EventLog(file);
  let mind = new Mind({ log, gate: new Gate({ log }) });
  for (let i = 0; i < 6; i++) mind.turn(log.ownerSays('question ' + i + '?'), { observedKind: 'asks' });
  const needs = { ...mind.needs };
  const guess = mind.predictor.predict();
  log.close();
  log = new EventLog(file);
  mind = new Mind({ log, gate: new Gate({ log }) });
  for (const k of Object.keys(needs)) assert.ok(Math.abs(mind.needs[k] - needs[k]) < 0.05, k);
  assert.deepEqual(mind.predictor.predict(), guess);
  log.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
