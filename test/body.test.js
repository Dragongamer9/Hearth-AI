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
const { Models, readVrmMeta } = require('../src/main/models');

function makeMind(info) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ithil-body-'));
  const store = new Store(dir);
  const settings = new Settings(store);
  let shots = 0;
  const hooks = {
    idleSeconds: () => 9999,
    bodyInfo: () => info || { kind: 'vrm', name: 'Ithil', movable: true, visible: true, expressions: ['happy', 'angry', 'neutral', 'relaxed', 'surprised', 'blink'] },
    seeBody: async () => { shots++; return 'iVBORw0KGgo='; }
  };
  const mind = new Mind({ store, brain: new FakeBrain(), settings, rules: new Rules(store), body: null, hooks });
  return { mind, store, settings, shots: () => shots };
}

function fakeVrm(file, meta1) {
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, extensions: meta1 ? { VRMC_vrm: { meta: meta1 } } : { VRM: { meta: { title: 'Arch-chan', author: 'x', licenseName: 'CC0' } } } }));
  const pad = Buffer.alloc((4 - (json.length % 4)) % 4, 0x20);
  const chunk = Buffer.concat([json, pad]);
  const head = Buffer.alloc(20);
  head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(20 + chunk.length, 8); head.writeUInt32LE(chunk.length, 12); head.write('JSON', 16);
  fs.writeFileSync(file, Buffer.concat([head, chunk]));
}

test('she can move her own body: poses, gestures, faces', () => {
  const { mind } = makeMind();
  const b = mind.moveBody({ pose: 'hand on hip', gesture: 'wave', face: 'happy' }, 'saying hi');
  assert.equal(b.pose, 'hand on hip');
  assert.equal(b.gesture, 'wave');
  assert.equal(b.face, 'happy');
  assert.ok(b.until > Date.now());
  assert.equal(mind.moveBody({ pose: 'backflip' }), null, 'unknown moves are ignored');
  const snap = snapshot(mind, {});
  assert.equal(snap.avatar.intent.pose, 'hand on hip');
  assert.match(snap.avatar.bodyLog[0].what, /wave/);
  assert.match(mind.bodyLine(), /you control it/);
});

test('without a movable body she doesn’t try to move', () => {
  const { mind } = makeMind({ kind: 'drawn', name: '', movable: false, visible: false, expressions: [] });
  assert.equal(mind.moveBody({ gesture: 'wave' }), null);
  assert.equal(mind.bodyLine(), '');
});

test('she can look at her own body, and remembers the first time', async () => {
  const { mind, store, shots } = makeMind();
  const seen = await mind.seeBody(true);
  assert.ok(seen && seen.saw.length > 0);
  assert.equal(shots(), 1);
  assert.ok(store.memories.items.some((m) => /first time/.test(m.text) && m.weight === 'core'));
  assert.equal(await mind.seeBody(false), null, 'not again so soon');
});

test('her rules allow her body and self-sight', () => {
  const { mind } = makeMind();
  assert.equal(mind.rules.check({ type: 'body' }).ok, true);
  assert.equal(mind.rules.check({ type: 'see_body' }).ok, true);
});

test('models: VRM license and name are read, Live2D license file is found', () => {
  const { store } = makeMind();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'models-'));
  const a = path.join(tmp, 'Ithil.vrm');
  fakeVrm(a, { name: 'Ithil', authors: ['Dragongamer9'], licenseUrl: 'https://vrm.dev/licenses/1.0/', commercialUsage: 'personalNonProfit' });
  assert.equal(readVrmMeta(a).name, 'Ithil');
  const models = new Models(store, () => 'Ithil');
  const m1 = models.importVrm(a);
  assert.equal(m1.license, 'Yours');
  const b = path.join(tmp, 'arch.vrm');
  fakeVrm(b, null);
  const m2 = models.importVrm(b);
  assert.equal(m2.name, 'Arch-chan 3D');
  assert.match(m2.license, /CC0/);
  const l2 = path.join(tmp, 'haru');
  fs.mkdirSync(path.join(l2, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(l2, 'runtime', 'haru.model3.json'), '{}');
  fs.writeFileSync(path.join(l2, 'LICENSE.txt'), 'Free for personal use.');
  const m3 = models.importLive2d(l2);
  assert.equal(m3.kind, 'live2d');
  assert.equal(m3.file, path.join('runtime', 'haru.model3.json'));
  assert.match(m3.license, /LICENSE\.txt/);
  assert.match(m3.licenseText, /personal use/);
  const bad = path.join(tmp, 'notvrm.vrm'); fs.writeFileSync(bad, 'hello world, not a model');
  assert.throws(() => models.importVrm(bad), /not a VRM/);
  assert.ok(models.remove(m1.id));
  assert.equal(models.list.length, 2);
  assert.ok(fs.existsSync(a), 'original file untouched');
});
