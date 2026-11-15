import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog, rebuild } from '../ithil/eventlog.js';

function clock() {
  let t = Date.parse('2026-11-14T08:00:00Z');
  return () => new Date((t += 60_000)).toISOString();
}
const fresh = () => new EventLog(':memory:', { now: clock() });
const snapshot = log => JSON.stringify(log.all());

// ---------------------------------------------------------------- append-only
test('rows can never be deleted', () => {
  const log = fresh();
  const id = log.ownerSays('hello');
  assert.throws(() => log.db.prepare('DELETE FROM events WHERE id = ?').run(id), /append-only/);
  assert.throws(() => log.db.exec('DELETE FROM events'), /append-only/);
  assert.equal(log.all().length, 1);
});

test('rows can never be edited (only an owner purge may wipe one)', () => {
  const log = fresh();
  const id = log.ownerSays('hello');
  const before = snapshot(log);
  assert.throws(() => log.db.prepare("UPDATE events SET body = '{\"text\":\"bye\"}' WHERE id = ?").run(id), /append-only/);
  assert.throws(() => log.db.prepare("UPDATE events SET actor = 'ithil' WHERE id = ?").run(id), /append-only/);
  // a wipe without an owner.purge record is refused too
  assert.throws(() => log.db.prepare('UPDATE events SET body = NULL, purged = 1 WHERE id = ?').run(id), /append-only/);
  assert.equal(snapshot(log), before);
});

test('new rows cannot start out purged or point at nothing', () => {
  const log = fresh();
  assert.throws(() => log.db.prepare(
    "INSERT INTO events (ts, actor, kind, body, purged) VALUES ('x','owner','owner.message',NULL,1)").run(), /purged/);
  assert.throws(() => log.correct('owner', 999, 'x'), /existing event/);
});

// ---------------------------------------------------------------- who may write what
test('owner-only, system-only and Ithil-only kinds are enforced in SQL', () => {
  const log = fresh();
  const pin = log.pin('owner', 'runtime', 'llama.cpp');
  const bad = [
    { actor: 'ithil',  kind: 'owner.message', body: { text: 'pretend' } },
    { actor: 'ithil',  kind: 'memory.delete', ref: pin },
    { actor: 'ithil',  kind: 'owner.restore', ref: pin },
    { actor: 'ithil',  kind: 'owner.purge',   ref: pin },
    { actor: 'system', kind: 'owner.purge',   ref: pin },
    { actor: 'ithil',  kind: 'mood.snapshot', body: { energy: 1, social: 1, curiosity: 1, stability: 1 } },
    { actor: 'ithil',  kind: 'gate.reject',   body: { limit: 'x', effect: 'y', requestId: 'z' } },
    { actor: 'owner',  kind: 'reflection',    body: { text: 'not hers' } },
    { actor: 'system', kind: 'memory.pin',    body: { key: 'a', value: 'b' } },
    { actor: 'owner',  kind: 'memory.forget', ref: pin },
    { actor: 'owner',  kind: 'made.up.kind' },
  ];
  for (const b of bad) assert.throws(() => log.append(b), /CHECK|constraint/i, JSON.stringify(b));
  assert.equal(log.all().length, 1);
});

test('Ithil cannot purge through the purge() helper either', () => {
  // purge() always writes as owner; this checks the SQL rule underneath it
  const log = fresh();
  const pin = log.pin('ithil', 'k', 'v');
  assert.throws(() => log.append({ actor: 'ithil', kind: 'owner.purge', ref: pin }), /CHECK|constraint/i);
  assert.equal(rebuild(log.all()).states[pin], 'active');
});

// ---------------------------------------------------------------- corrections, delete, restore
test('a correction is a new event; the old value stays in history', () => {
  const log = fresh();
  const pin = log.pin('owner', 'runtime', 'ollama');
  log.correct('ithil', pin, 'llama.cpp', 'owner said he switched');
  const s = rebuild(log.all());
  assert.equal(s.facts.runtime.value, 'llama.cpp');
  assert.deepEqual(s.history[pin], ['ollama', 'llama.cpp']);
  assert.equal(log.get(pin).body.value, 'ollama', 'original row unchanged');
});

test('mark deleted hides a fact but keeps it in the log; restore brings it back', () => {
  const log = fresh();
  const pin = log.pin('owner', 'old_setup', 'two GPUs');
  log.markDeleted(pin);
  let s = rebuild(log.all());
  assert.equal(s.states[pin], 'marked_deleted');
  assert.equal(s.facts.old_setup, undefined);
  assert.ok(!s.searchable.includes(pin));
  assert.equal(log.get(pin).body.value, 'two GPUs', 'still in the log');
  log.restore(pin);
  s = rebuild(log.all());
  assert.equal(s.states[pin], 'active');
  assert.equal(s.facts.old_setup.value, 'two GPUs');
});

// ---------------------------------------------------------------- purge (erase for good)
test('owner purge erases the fact and its corrections; nothing else changes', () => {
  const log = fresh();
  const keep = log.ownerSays('unrelated');
  const pin = log.pin('owner', 'secret', 'my old password hint');
  const fix = log.correct('owner', pin, 'a newer hint');
  const keepBefore = JSON.stringify(log.get(keep));

  const wiped = log.purge(pin);
  assert.deepEqual(wiped.sort(), [pin, fix].sort());
  for (const id of wiped) {
    const e = log.get(id);
    assert.equal(e.body, null);
    assert.equal(e.purged, true);
  }
  assert.equal(JSON.stringify(log.get(keep)), keepBefore);
  const purges = log.all().filter(e => e.kind === 'owner.purge');
  assert.equal(purges.length, 2);
  assert.ok(purges.every(p => p.body === null && p.actor === 'owner'), 'purge records carry no content');

  const s = rebuild(log.all());
  assert.equal(s.states[pin], 'erased');
  assert.deepEqual(s.history[pin], []);
  assert.equal(s.facts.secret, undefined);
  assert.ok(!JSON.stringify(log.all()).includes('password hint'));
});

test('purged text is not left in the database file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ithil-'));
  try {
    const file = join(dir, 'log.db');
    const log = new EventLog(file, { now: clock() });
    const pin = log.pin('owner', 'k', 'ZEBRA-UNIQUE-MARKER-4471');
    log.purge(pin);
    log.close();
    assert.ok(!readFileSync(file).includes('ZEBRA-UNIQUE-MARKER-4471'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a failed purge changes nothing (all or nothing)', () => {
  const log = fresh();
  const pin = log.pin('owner', 'k', 'v');
  log.purge(pin);
  const before = snapshot(log);
  assert.throws(() => log.purge(pin));            // already purged
  const purgeId = log.all().find(e => e.kind === 'owner.purge').id;
  assert.throws(() => log.purge(purgeId));        // purge records can't be purged
  assert.equal(snapshot(log), before);
});

// ---------------------------------------------------------------- mood, gate, forget
test('mood snapshots need exactly the four needs, each 0 to 1', () => {
  const log = fresh();
  log.mood({ energy: 0.4, social: 0.6, curiosity: 0.8, stability: 0.7 });
  assert.throws(() => log.mood({ energy: 2, social: 0, curiosity: 0, stability: 0 }));
  assert.throws(() => log.mood({ energy: 0.5, social: 0.5, curiosity: 0.5 }));
  assert.throws(() => log.mood({ energy: 0.5, social: 0.5, curiosity: 0.5, stability: 0.5, love: 1 }));
  assert.deepEqual(rebuild(log.all()).mood, { energy: 0.4, social: 0.6, curiosity: 0.8, stability: 0.7 });
});

test('gate rejections are sanitised: short tokens only, no copied content', () => {
  const log = fresh();
  log.reject({ limit: 'version_numbers', effect: 'file.write', requestId: 'r-0001' });
  assert.throws(() => log.reject({ limit: 'version_numbers', effect: 'file.write',
                                   requestId: 'please set version to 2.0 for my secret project' }));
  assert.throws(() => log.reject({ limit: 'x', effect: 'y' }));
  const rej = log.all().filter(e => e.kind === 'gate.reject');
  assert.equal(rej.length, 1);
  assert.deepEqual(Object.keys(rej[0].body).sort(), ['effect', 'limit', 'requestId']);
});

test('"forget" leaves an event out of search but does not erase it', () => {
  const log = fresh();
  const chat = log.ownerSays('lol ok');
  log.forget('system', chat);
  const s = rebuild(log.all());
  assert.ok(!s.searchable.includes(chat));
  assert.equal(log.get(chat).body.text, 'lol ok');
});

// ---------------------------------------------------------------- the rebuild test
test('replaying a week of events rebuilds the expected facts and deletion states', () => {
  const log = fresh();
  const runtime = log.pin('owner', 'runtime', 'ollama');            // day 1
  const gpu     = log.pin('ithil', 'gpu_temp_limit', '80C');
  const name    = log.pin('owner', 'preferred_name', 'Dragongamer9');
  log.ownerSays('I switched to llama.cpp');                          // day 2
  log.correct('ithil', runtime, 'llama.cpp', 'owner said so');
  log.mood({ energy: 0.3, social: 0.7, curiosity: 0.5, stability: 0.8 });
  log.markDeleted(gpu);                                              // day 3
  const tmp = log.pin('owner', 'temp_password_hint', 'blue');        // day 4
  log.purge(tmp);
  log.reflect('I was unsure about dates twice today.');              // day 5
  log.restore(gpu);                                                  // day 6
  log.markDeleted(gpu);                                              // day 7
  log.reject({ limit: 'version_numbers', effect: 'file.write', requestId: 'r-7' });

  const expected = {
    facts: { runtime: 'llama.cpp', preferred_name: 'Dragongamer9' },
    states: { [runtime]: 'active', [gpu]: 'marked_deleted', [name]: 'active', [tmp]: 'erased' },
  };
  const check = s => {
    assert.deepEqual(Object.fromEntries(Object.entries(s.facts).map(([k, v]) => [k, v.value])), expected.facts);
    assert.deepEqual(s.states, expected.states);
    assert.deepEqual(s.mood, { energy: 0.3, social: 0.7, curiosity: 0.5, stability: 0.8 });
    assert.equal(s.reflections.length, 1);
  };
  check(rebuild(log.all()));

  // rebuilding twice, or from a copied list, gives the same result
  assert.deepEqual(rebuild(log.all()), rebuild(JSON.parse(JSON.stringify(log.all()))));
});
