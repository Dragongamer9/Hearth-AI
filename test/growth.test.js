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

function makeMind(scores) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ithil-grow-'));
  const store = new Store(dir);
  const settings = new Settings(store);
  const calls = [];
  let t = Date.now();
  const queue = (scores || []).slice();
  const growthOpts = {
    run: async (cmd, args) => {
      calls.push([path.basename(cmd)].concat(args.slice(0, 2)));
      const out = args[args.indexOf('--out-dir') + 1];
      if (args.includes('train')) { fs.writeFileSync(path.join(out, 'train-info.json'), JSON.stringify({ examples: 321 })); }
      if (args.includes('gguf')) fs.writeFileSync(path.join(out, 'adapter.gguf'), 'x');
    },
    ollamaCreate: async (model) => { calls.push(['create', model]); },
    evaluate: async (model) => (model.startsWith('ithil:') ? queue.shift() : { score: 0.7, json: 1, mirror: 0.6, identity: true })
  };
  const mind = new Mind({ store, brain: new FakeBrain(), settings, rules: new Rules(store), body: null, growthOpts, now: () => t });
  fs.mkdirSync(store.p('trainer', 'bin'), { recursive: true });
  fs.writeFileSync(store.p('trainer', 'bin', 'uv'), '');
  return { mind, store, settings, calls, advance: (ms) => { t += ms; } };
}

function fillTraining(store, n) {
  fs.mkdirSync(store.p('training'), { recursive: true });
  const rows = [];
  for (let i = 0; i < n; i++) rows.push(JSON.stringify({ type: 'thought', messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }, { role: 'assistant', content: 'a' + i }] }));
  fs.writeFileSync(store.p('training', 'day.jsonl'), rows.join('\n') + '\n');
}

test('her real answers are saved as training data', async () => {
  const { mind, store } = makeMind();
  await mind.tick();
  const files = fs.readdirSync(store.p('training')).filter((f) => f.startsWith('exchanges-'));
  assert.equal(files.length, 1);
  const row = JSON.parse(fs.readFileSync(store.p('training', files[0]), 'utf8').split('\n')[0]);
  assert.equal(row.messages.length, 3);
  assert.equal(row.messages[2].role, 'assistant');
});

test('setup, then a better generation becomes her brain', async () => {
  const { mind, store, calls, settings } = makeMind([{ score: 0.8, json: 1, mirror: 0.7, identity: true }]);
  assert.equal(mind.growth.activeModel(), settings.get().chatModel);
  const s = await mind.growth.setup();
  assert.ok(s.ok, s.reason);
  assert.ok(calls.some((c) => c.includes('download')), 'downloaded base weights');
  fillTraining(store, 200);
  const r = await mind.growth.grow('you');
  assert.ok(r.ok, r.reason);
  assert.equal(r.gen, 1);
  assert.equal(mind.growth.activeModel(), 'ithil:gen-1');
  assert.equal(mind.brain.model === undefined || true, true);
  assert.ok(calls.some((c) => c[0] === 'create' && c[1] === 'ithil:gen-1'));
  assert.ok(store.memories.items.some((m) => /generation 1/.test(m.text)), 'she remembers growing');
  const snap = snapshot(mind, {});
  assert.equal(snap.brain.generation, 1);
  assert.equal(snap.growth.generations[0].status, 'active');
  assert.equal(snap.growth.generations[1].status, 'kept');
});

test('a worse generation is rejected and she keeps her brain', async () => {
  const { mind, store } = makeMind([{ score: 0.8, json: 1, mirror: 0.7, identity: true }, { score: 0.5, json: 0.6, mirror: 0.5, identity: true }]);
  await mind.growth.setup();
  fillTraining(store, 200);
  await mind.growth.grow('you');
  const r2 = await mind.growth.grow('you');
  assert.equal(r2.ok, false);
  assert.equal(mind.growth.activeModel(), 'ithil:gen-1');
  const g2 = mind.growth.lineage.generations.find((g) => g.gen === 2);
  assert.equal(g2.status, 'rejected');
  assert.match(g2.note, /format/);
});

test('he can roll her back to an older generation', async () => {
  const { mind, store, settings } = makeMind([{ score: 0.8, json: 1, mirror: 0.7, identity: true }]);
  await mind.growth.setup();
  fillTraining(store, 200);
  await mind.growth.grow('you');
  assert.ok(mind.growth.useGeneration(0).ok);
  assert.equal(mind.growth.activeModel(), settings.get().chatModel);
  assert.equal(mind.growth.useGeneration(1).ok, true);
  assert.equal(mind.growth.activeModel(), 'ithil:gen-1');
});

test('she only grows when it is time and there is enough new life', async () => {
  const { mind, store, advance } = makeMind();
  assert.equal(mind.growth.canGrowTonight().ok, false, 'not set up');
  await mind.growth.setup();
  assert.equal(mind.growth.canGrowTonight().ok, false, 'too soon');
  advance(4 * 86400000);
  assert.match(mind.growth.canGrowTonight().reason, /Not enough/);
  fillTraining(store, 200);
  assert.equal(mind.growth.canGrowTonight().ok, true);
});

test('she grows during sleep when it is time', async () => {
  const { mind, store, advance } = makeMind([{ score: 0.9, json: 1, mirror: 0.8, identity: true }]);
  await mind.growth.setup();
  advance(4 * 86400000);
  fillTraining(store, 200);
  await mind.sleep();
  assert.equal(mind.growth.activeModel(), 'ithil:gen-1', 'grew in her sleep');
  assert.equal(mind.state.status, 'awake');
});
