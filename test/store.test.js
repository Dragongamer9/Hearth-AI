'use strict';
// 0.5: her settings and state are never replaced by defaults because a file couldn't be read.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/main/mind/store');

test('every write keeps the last good file as .bak', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ithil-store-'));
  const s = new Store(dir);
  s.writeState('settings', { a: 1 });
  s.writeState('settings', { a: 2 });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json.bak'), 'utf8')), { a: 1 });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an unreadable file: the .bak is used, and the broken file is kept aside', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ithil-store-'));
  const s = new Store(dir);
  s.writeState('state', { name: 'Ithil', day: 3 });
  s.writeState('state', { name: 'Ithil', day: 4 });
  fs.writeFileSync(path.join(dir, 'state.json'), '{"name": "Ith');   // cut off mid-write
  assert.deepEqual(s.readState('state', {}), { name: 'Ithil', day: 3 });
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('state.json.unreadable-')), 'the broken file is kept');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')), { name: 'Ithil', day: 3 });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an unreadable file with no .bak: the fallback, and the broken file is still kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ithil-store-'));
  const s = new Store(dir);
  fs.writeFileSync(path.join(dir, 'settings.json'), 'not json');
  assert.deepEqual(s.readState('settings', { x: 1 }), { x: 1 });
  const aside = fs.readdirSync(dir).find((f) => f.startsWith('settings.json.unreadable-'));
  assert.equal(fs.readFileSync(path.join(dir, aside), 'utf8'), 'not json');
  fs.rmSync(dir, { recursive: true, force: true });
});
