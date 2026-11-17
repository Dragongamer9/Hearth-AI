'use strict';
// 0.6: Colibri first, Ollama as the fallback. A fake Colibri (OpenAI-compatible, streaming) and a fake Ollama.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ColibriBrain, BrainRouter, findColibri, readRegistry, catalog, recommend, CATALOG, toOpenAI } = require('../src/main/mind/engines');
const { OllamaBrain, FakeBrain } = require('../src/main/mind/llm');
const { Store } = require('../src/main/mind/store');
const { Settings } = require('../src/main/mind/settings');
const { Rules } = require('../src/main/mind/rules');
const { Mind } = require('../src/main/mind/engine');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p || 'ithil-eng-'));
const fakeMindAnswers = new FakeBrain();

function listen(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port, close: () => new Promise((r) => { srv.closeAllConnections && srv.closeAllConnections(); srv.close(() => r()); }) }));
  });
}
function readBody(req) { return new Promise((r) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => r(b ? JSON.parse(b) : {})); }); }

// A fake Colibri. mode: 'ok' | 'midstream' | 'error500' | 'notools' | 'tools' | 'stall'
async function fakeColibri(o) {
  const st = Object.assign({ mode: 'ok', vision: false, model: 'qwen36-35b', calls: [] }, o || {});
  const s = await listen(async (req, res) => {
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ object: 'list', data: [{ id: st.model, object: 'model', owned_by: 'colibri', input_modalities: st.vision ? ['text', 'image'] : ['text'], capabilities: ['chat', 'systemone'], context_length: 32768 }] }));
    }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      const body = await readBody(req);
      st.calls.push(body);
      if (body.model !== st.model) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'The model `' + body.model + '` does not exist.' } })); }
      if (st.mode === 'error500') { res.writeHead(500, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'engine crashed' } })); }
      if (st.mode === 'notools' && body.tools) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'This engine has no tool translation.' } })); }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');
      const sys = (body.messages[0] && typeof body.messages[0].content === 'string' ? body.messages[0].content : '') + '\n' + (typeof body.messages[body.messages.length - 1].content === 'string' ? body.messages[body.messages.length - 1].content : '');
      if (st.mode === 'tools' && body.tools) {
        send({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'write_', arguments: '{"path":"no' } }] } }] });
        send({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: 'file', arguments: 'tes.md"}' } }] }, finish_reason: 'tool_calls' }] });
        send({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 12, total_tokens: 22 } });
        res.write('data: [DONE]\n\n');
        return res.end();
      }
      const text = body.response_format ? JSON.stringify(fakeMindAnswers._json(sys)) : 'Hello from Colibri.';
      const pieces = text.match(/[\s\S]{1,8}/g);
      if (st.mode === 'midstream') { send({ choices: [{ index: 0, delta: { content: pieces[0] } }] }); return setTimeout(() => res.socket.destroy(), 20); }
      if (st.mode === 'stall') { send({ choices: [{ index: 0, delta: { content: pieces[0] } }] }); return; }
      for (const p of pieces) send({ choices: [{ index: 0, delta: { content: p } }] });
      send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
      send({ choices: [], usage: { prompt_tokens: 10, completion_tokens: pieces.length, total_tokens: 10 + pieces.length } });
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    res.writeHead(404); res.end();
  });
  return Object.assign(s, { st, url: 'http://127.0.0.1:' + s.port + '/v1' });
}

// A fake Ollama.
async function fakeOllama() {
  const st = { calls: [] };
  const s = await listen(async (req, res) => {
    if (req.url === '/api/tags') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ models: [{ name: 'huihui_ai/qwen3-abliterated:8b-v2' }, { name: 'nomic-embed-text:latest' }] })); }
    const body = await readBody(req);
    st.calls.push(Object.assign({ path: req.url }, body));
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url === '/api/embed') return res.end(JSON.stringify({ embeddings: body.input.map(() => [0.1, 0.2, 0.3]) }));
    if (req.url === '/api/generate') return res.end('{}');
    if (req.url === '/api/chat') {
      if (body.tools) return res.end(JSON.stringify({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'write_file', arguments: { path: 'notes.md' } } }] }, eval_count: 20, eval_duration: 1e9 }));
      const sys = body.messages[0].content + '\n' + body.messages[body.messages.length - 1].content;
      const content = body.format === 'json' ? JSON.stringify(fakeMindAnswers._json(sys)) : 'Hello from Ollama.';
      return res.end(JSON.stringify({ message: { role: 'assistant', content }, eval_count: 40, eval_duration: 2e9 }));
    }
    res.end('{}');
  });
  return Object.assign(s, { st, url: 'http://127.0.0.1:' + s.port });
}

function router(colibriUrl, ollamaUrl, extra) {
  const settings = Object.assign({ brainEngine: 'colibri', colibriUrl, ollamaUrl, chatModel: 'huihui_ai/qwen3-abliterated:8b-v2', visionModel: 'vision-model', embedModel: 'nomic-embed-text' }, extra && extra.settings);
  const get = () => settings;
  const switches = [];
  let t = 1000000;
  const r = new BrainRouter(Object.assign({
    getSettings: get,
    colibri: new ColibriBrain(get, { idleMs: 300, registryFile: '/nonexistent' }),
    ollama: new OllamaBrain(get),
    onSwitch: (e) => switches.push(e),
    now: () => t
  }, extra && extra.router));
  return { r, settings, switches, advance: (ms) => { t += ms; } };
}
const closedPort = async () => { const s = await listen(() => {}); const p = s.port; await s.close(); return 'http://127.0.0.1:' + p + '/v1'; };

test('Colibri answers first, streamed, with tokens per second', async () => {
  const c = await fakeColibri(), o = await fakeOllama();
  try {
    const { r, switches } = router(c.url, o.url);
    const got = [];
    const text = await r.chat([{ role: 'user', content: 'hi' }], { onToken: (t) => got.push(t) });
    assert.equal(text, 'Hello from Colibri.');
    assert.ok(got.length > 1, 'it streamed in pieces');
    assert.equal(r.answering, 'colibri');
    assert.equal(switches.length, 1);
    assert.ok(r.colibri.stats.tokensPerSec > 0);
    assert.equal(o.st.calls.length, 0, 'Ollama was not asked');
    const j = await r.json('TASK:TALK\nYou are Ithil.', 'Hey');
    assert.match(j.reply, /Good to see you/);
    assert.deepEqual(c.st.calls[1].response_format, { type: 'json_object' });
    assert.equal(c.st.calls[1].enable_thinking, false);
    assert.equal(r.status().answering, 'colibri');
    assert.equal(r.status().model, 'qwen36-35b');
  } finally { await c.close(); await o.close(); }
});

test('Colibri not running: Ollama answers the same request, the switch is logged, Colibri rests', async () => {
  const o = await fakeOllama();
  try {
    const { r, switches, advance } = router(await closedPort(), o.url);
    const j = await r.json('TASK:TALK\nYou are Ithil.', 'Hey');
    assert.match(j.reply, /Good to see you/);
    assert.equal(r.answering, 'ollama');
    assert.equal(switches[switches.length - 1].to, 'ollama');
    assert.match(switches[switches.length - 1].why, /Colibri/);
    // Resting: the next request goes straight to Ollama.
    const before = o.st.calls.length;
    await r.chat([{ role: 'user', content: 'again' }]);
    assert.equal(o.st.calls.length, before + 1);
    assert.equal(r.plan([], {}).order[0], 'ollama');
    advance(31000);
    assert.equal(r.plan([], {}).order[0], 'colibri', 'tried again after its rest');
  } finally { await o.close(); }
});

test('Colibri breaks halfway through an answer: what it said is dropped and Ollama answers the whole thing', async () => {
  const c = await fakeColibri({ mode: 'midstream' }), o = await fakeOllama();
  try {
    const { r, switches } = router(c.url, o.url);
    const seen = [];
    let resets = 0;
    const text = await r.chat([{ role: 'system', content: 'You are Ithil.' }, { role: 'user', content: 'tell me' }], { onToken: (t, info) => { if (info && info.reset) { resets++; seen.length = 0; } else seen.push(t); } });
    assert.equal(text, 'Hello from Ollama.');
    assert.equal(resets, 1);
    assert.equal(seen.join(''), 'Hello from Ollama.');
    assert.match(switches[switches.length - 1].why, /halfway|stopped/);
    assert.equal(o.st.calls[0].messages[1].content, 'tell me', 'Ollama got the same conversation');
  } finally { await c.close(); await o.close(); }
});

test('Colibri stalls: after the idle limit Ollama answers', async () => {
  const c = await fakeColibri({ mode: 'stall' }), o = await fakeOllama();
  try {
    const { r } = router(c.url, o.url);
    const text = await r.chat([{ role: 'user', content: 'hi' }]);
    assert.equal(text, 'Hello from Ollama.');
  } finally { await c.close(); await o.close(); }
});

test('the model errors (500): Ollama answers', async () => {
  const c = await fakeColibri({ mode: 'error500' }), o = await fakeOllama();
  try {
    const { r } = router(c.url, o.url);
    assert.equal(await r.chat([{ role: 'user', content: 'hi' }]), 'Hello from Ollama.');
    assert.ok(r.restUntil > 0);
  } finally { await c.close(); await o.close(); }
});

test('tool calls: Colibri streams them in pieces; a model without tools falls back for that request only', async () => {
  const c = await fakeColibri({ mode: 'tools' }), o = await fakeOllama();
  const tools = [{ type: 'function', function: { name: 'write_file', description: 'write a file', parameters: { type: 'object', properties: { path: { type: 'string' } } } } }];
  try {
    const { r } = router(c.url, o.url);
    const a = await r.chat([{ role: 'user', content: 'write notes' }], { tools });
    assert.deepEqual(a.toolCalls, [{ id: 'call_1', name: 'write_file', arguments: { path: 'notes.md' } }]);
    assert.equal(r.answering, 'colibri');
    c.st.mode = 'notools';
    const b = await r.chat([{ role: 'user', content: 'write notes' }], { tools });
    assert.deepEqual(b.toolCalls, [{ id: 'call_0', name: 'write_file', arguments: { path: 'notes.md' } }]);
    assert.equal(r.restUntil, 0, 'a missing ability is not a broken Colibri');
    c.st.mode = 'ok';
    assert.equal(await r.chat([{ role: 'user', content: 'hi' }]), 'Hello from Colibri.');
  } finally { await c.close(); await o.close(); }
});

test('pictures: Colibri without vision sends sight to her Ollama sight model; with vision Colibri sees', async () => {
  const c = await fakeColibri({ vision: false }), o = await fakeOllama();
  try {
    const { r } = router(c.url, o.url);
    await r.available();
    await r.see('aGVsbG8=', 'What do you see?');
    assert.equal(o.st.calls[0].model, 'vision-model');
    const t = await r.chat([{ role: 'user', content: 'look', images: ['aGVsbG8='] }]);
    assert.equal(t, 'Hello from Ollama.');
    assert.equal(o.st.calls[1].model, 'vision-model');
    assert.equal(r.restUntil, 0);
    c.st.vision = true;
    await r.available();
    assert.equal(await r.see('aGVsbG8=', 'What do you see?'), 'Hello from Colibri.');
    const parts = c.st.calls[c.st.calls.length - 1].messages[0].content;
    assert.equal(parts[1].type, 'image_url');
    assert.match(parts[1].image_url.url, /^data:image\/png;base64,/);
  } finally { await c.close(); await o.close(); }
});

test('Ollama only: Colibri is never asked; memory search always uses Ollama', async () => {
  const c = await fakeColibri(), o = await fakeOllama();
  try {
    const { r } = router(c.url, o.url, { settings: { brainEngine: 'ollama' } });
    assert.equal(await r.chat([{ role: 'user', content: 'hi' }]), 'Hello from Ollama.');
    assert.equal(c.st.calls.length, 0);
    const v = await r.embed(['x']);
    assert.deepEqual(v[0], [0.1, 0.2, 0.3]);
  } finally { await c.close(); await o.close(); }
});

test('her grown brain (Ollama) is used while Colibri does not serve it, unless he turns that off', async () => {
  const c = await fakeColibri(), o = await fakeOllama();
  try {
    const { r, settings } = router(c.url, o.url, { router: { grownModel: () => 'ithil:gen-2' } });
    await r.chat([{ role: 'user', content: 'hi' }]);
    assert.equal(r.answering, 'ollama');
    assert.match(r.status().why, /grown brain/);
    settings.preferGrownBrain = false;
    assert.equal(await r.chat([{ role: 'user', content: 'hi' }]), 'Hello from Colibri.');
  } finally { await c.close(); await o.close(); }
});

test('Colibri comes back: the next request after its rest goes to Colibri and the switch back is logged', async () => {
  const o = await fakeOllama();
  let c = null;
  try {
    const dead = await closedPort();
    const { r, switches, advance, settings } = router(dead, o.url);
    await r.chat([{ role: 'user', content: 'hi' }]);
    assert.equal(r.answering, 'ollama');
    c = await fakeColibri();
    settings.colibriUrl = c.url;
    advance(31000);
    assert.equal(await r.chat([{ role: 'user', content: 'hi' }]), 'Hello from Colibri.');
    assert.equal(switches[switches.length - 1].to, 'colibri');
    assert.equal(switches[switches.length - 1].why, 'Colibri is answering again');
  } finally { if (c) await c.close(); await o.close(); }
});

test('mid-conversation switch is seamless for her mind: she keeps talking, Ollama sees the whole conversation', async () => {
  const c = await fakeColibri(), o = await fakeOllama();
  const dir = tmp();
  try {
    const store = new Store(dir);
    const settings = new Settings(store);
    settings.setByUser({ colibriUrl: c.url, ollamaUrl: o.url });
    const switches = [];
    const brain = new BrainRouter({ getSettings: () => settings.get(), colibri: new ColibriBrain(() => settings.get(), { idleMs: 300, registryFile: '/nonexistent' }), ollama: new OllamaBrain(() => settings.get()), onSwitch: (e) => switches.push(e) });
    const body = { state: null, firstFan: { fans: false }, async sense() { return null; }, async gaming() { return { gaming: false, apps: [] }; } };
    const mind = new Mind({ store, brain, settings, rules: new Rules(store), body, hooks: { idleSeconds: () => 9999 } });
    const a = await mind.talk('Hey, are you there?');
    assert.match(a.text, /Good to see you/);
    assert.equal(brain.answering, 'colibri');
    c.st.mode = 'midstream';
    const b = await mind.talk('What did I just ask you?');
    assert.ok(!b.error, 'she answered, not an error');
    assert.equal(brain.answering, 'ollama');
    const talk = o.st.calls.filter((x) => x.path === '/api/chat').pop();
    assert.match(talk.messages[1].content, /Hey, are you there\?/, 'Ollama got the earlier part of the conversation');
    assert.ok(switches.some((x) => x.from === 'colibri' && x.to === 'ollama'));
    // Her real answers are still saved for her own future brain, whichever engine gave them.
    const train = fs.readdirSync(store.p('training')).filter((f) => f.startsWith('exchanges-'));
    assert.ok(train.length >= 1);
    mind.stop && mind.stop();
  } finally { await c.close(); await o.close(); }
});

test('where Colibri is: his setting, then Hearth OS’s ai-engines.json, then HEARTH_COLIBRI_URL, then the default', () => {
  const d = tmp();
  const reg = path.join(d, 'ai-engines.json');
  assert.equal(findColibri({}, {}, reg).url, 'http://127.0.0.1:8000/v1');
  assert.equal(findColibri({}, { HEARTH_COLIBRI_URL: '127.0.0.1:9000' }, reg).url, 'http://127.0.0.1:9000/v1');
  fs.writeFileSync(reg, JSON.stringify({ engines: [{ id: 'ollama', baseUrl: 'http://127.0.0.1:11434' }, { id: 'colibri', baseUrl: 'http://127.0.0.1:8123/v1', model: 'qwen36-35b' }] }));
  const w = findColibri({}, {}, reg);
  assert.equal(w.url, 'http://127.0.0.1:8123/v1');
  assert.equal(w.managed, true);
  fs.writeFileSync(reg, JSON.stringify({ colibri: { port: 8200 } }));
  assert.equal(findColibri({}, {}, reg).url, 'http://127.0.0.1:8200/v1');
  fs.writeFileSync(reg, JSON.stringify({ engines: { colibri: { url: 'http://box:8000' } } }));
  assert.equal(findColibri({}, {}, reg).url, 'http://box:8000/v1');
  assert.equal(findColibri({ colibriUrl: 'http://127.0.0.1:7000/v1/' }, {}, reg).url, 'http://127.0.0.1:7000/v1');
  fs.writeFileSync(reg, '{ broken');
  assert.equal(readRegistry(reg).ok, false);
  assert.equal(findColibri({}, {}, reg).url, 'http://127.0.0.1:8000/v1');
  assert.equal(fs.readFileSync(reg, 'utf8'), '{ broken', 'Hearth OS’s file is never written');
});

test('the Colibri model list: every model it offers, the right one marked for a 12 GB RTX 5070 with 32 GB of RAM', async () => {
  const rows = recommend(CATALOG, 34e9, 1500e9);
  assert.equal(rows.length, CATALOG.length, 'nothing left out');
  const rec = rows.filter((x) => x.recommended);
  assert.equal(rec.length, 1);
  assert.equal(rec[0].id, 'qwen36-35b');
  assert.equal(rows[0].id, 'qwen36-35b');
  assert.equal(rows.find((x) => x.id === 'inkling').status, 'needs-ram');
  // With `coli` installed, its live list is used, whatever it holds.
  const d = tmp();
  const cli = path.join(d, 'coli');
  fs.writeFileSync(cli, '#!/bin/sh\n'); fs.chmodSync(cli, 0o755);
  const live = [{ id: 'new-model-9000', name: 'New 9000', download_gb: 40, ram_min_gb: 12, ram_good_gb: 24, runs: 'from RAM', kind: 'text', summary: 's', status: 'good', fits: true, recommended: true }, { id: 'qwen36-35b', name: 'Qwen3.6-35B-A3B', download_gb: 23.1, ram_min_gb: 10, ram_good_gb: 20, runs: 'from RAM', kind: 'text', status: 'good', fits: true, recommended: false }];
  let asked = null;
  const cat = await catalog({ settings: { colibriCli: cli }, env: { HOME: d, PATH: '' }, regFile: '/nonexistent', run: async (c, args) => { asked = args; return 'note\n' + JSON.stringify(live); }, served: 'qwen36-35b', grown: [{ gen: 2, dir: '/home/x/HearthAI/brain/gen-2/ithil-gen-2', model: 'ithil-gen-2' }] });
  assert.deepEqual(asked, ['setup', '--list', '--all', '--json']);
  assert.equal(cat.source, 'coli');
  assert.ok(cat.rows.some((x) => x.id === 'new-model-9000' && x.recommended));
  assert.ok(cat.rows.find((x) => x.id === 'qwen36-35b').running);
  assert.ok(cat.rows.some((x) => x.grown === 2));
  // Without `coli`, the copy of its catalog is used.
  const copy = await catalog({ settings: {}, env: { HOME: d, PATH: '' }, regFile: '/nonexistent', ramTotal: 34e9, diskFree: 1500e9 });
  assert.equal(copy.source, 'copy');
  assert.equal(copy.rows.length, CATALOG.length);
});

test('messages with pictures become OpenAI image parts', () => {
  const m = toOpenAI([{ role: 'user', content: 'see', images: ['QUJD'] }, { role: 'system', content: 'x' }]);
  assert.equal(m[0].content[0].text, 'see');
  assert.equal(m[0].content[1].image_url.url, 'data:image/png;base64,QUJD');
  assert.equal(m[1].content, 'x');
});

test('the engine setting is his and is kept safely: atomic, with a .bak, never replaced by defaults', () => {
  const dir = tmp();
  const store = new Store(dir);
  const s = new Settings(store);
  assert.equal(s.get().brainEngine, 'colibri');
  s.setByUser({ brainEngine: 'ollama', colibriModel: 'glm-5.3' });
  assert.ok(fs.existsSync(store.p('settings.json.bak')));
  assert.equal(new Settings(new Store(dir)).get().brainEngine, 'ollama');
  fs.writeFileSync(store.p('settings.json'), '{ not json');
  const again = new Settings(new Store(dir));
  assert.equal(again.get().brainEngine, 'ollama', 'the .bak was used, not the defaults');
  assert.equal(again.get().colibriModel, 'glm-5.3');
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('settings.json.unreadable-')), 'the broken file is kept aside');
});

test('her growth: a new generation is made ready for Colibri (merged GGUF + coli import), and failing that never stops her growing', async () => {
  const { Growth } = require('../src/main/mind/growth');
  const dir = tmp();
  const store = new Store(dir);
  const settings = new Settings(store);
  const calls = [];
  const mind = { store, settings, state: { born: Date.now(), name: 'Ithil', brain: { history: [] } }, emit() {}, moment(t) { calls.push(['moment', t]); }, now: () => Date.now() };
  const g = new Growth(mind, { coli: '/opt/colibri/c/coli', run: async (cmd, args) => { calls.push([path.basename(cmd)].concat(args)); } });
  const entry = { gen: 3, status: 'active' };
  g.lineage.generations.push(entry);
  const r = await g.forColibri(entry, path.join(dir, 'brain', 'gen-3'), '/base');
  assert.equal(r.ok, true);
  assert.ok(calls.some((c) => c[0] === 'python' && c.includes('merged')));
  const imp = calls.find((c) => c[0] === 'coli');
  assert.equal(imp[1], 'import');
  assert.match(imp[2], /ithil-gen-3-q8_0\.gguf$/);
  assert.deepEqual(g.colibriReady().map((x) => x.gen), [3]);
  const bad = new Growth(mind, { coli: '/opt/colibri/c/coli', run: async () => { throw new Error('out of disk'); } });
  const e2 = { gen: 4, status: 'active' };
  bad.lineage.generations.push(e2);
  const r2 = await bad.forColibri(e2, path.join(dir, 'brain', 'gen-4'), '/base');
  assert.equal(r2.ok, false);
  assert.match(r2.why, /out of disk/);
  const none = new Growth(mind, { coli: null });
  const e3 = { gen: 5 };
  assert.equal(await none.forColibri(e3, dir, '/base'), null);
  assert.match(e3.colibri.why, /isn’t installed/);
});
