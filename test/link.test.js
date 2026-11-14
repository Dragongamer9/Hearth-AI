'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { Store } = require('../src/main/mind/store');
const { Settings } = require('../src/main/mind/settings');
const { Rules } = require('../src/main/mind/rules');
const { FakeBrain } = require('../src/main/mind/llm');
const { Mind } = require('../src/main/mind/engine');
const { Link } = require('../src/main/link');

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ithil-link-'));
  const store = new Store(dir);
  const settings = new Settings(store);
  const mind = new Mind({ store, brain: new FakeBrain(), settings, rules: new Rules(store), body: null });
  const link = new Link(mind, { version: '0.3', port: 0 });
  link.start();
  await new Promise((r) => setTimeout(r, 100));
  const key = JSON.parse(fs.readFileSync(path.join(dir, 'connect.json'), 'utf8'));
  const base = 'http://127.0.0.1:' + link.port + '/v1';
  const call = async (method, p, body, token) => {
    const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (token == null ? key.token : token), 'x-client': 'Team lead' }, body: body ? JSON.stringify(body) : undefined });
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, json: ct.includes('json') ? await r.json() : null };
  };
  return { mind, link, key, call, dir, store, settings, base };
}

test('the Command Center can find her, talk to her and hand her a task', async () => {
  const { mind, link, key, call, store } = await setup();
  try {
    assert.equal(key.port, link.port);
    assert.equal((fs.statSync(path.join(store.dir, 'connect.json')).mode & 0o777), 0o600, 'key file is private');
    assert.equal((await call('GET', '/hello', null, '')).json.name, 'Ithil');
    assert.equal((await call('GET', '/status', null, 'wrong')).status, 401);
    const st = await call('GET', '/status');
    assert.equal(st.status, 200);
    assert.equal(st.json.name, 'Ithil');
    assert.ok(st.json.drives.curiosity >= 0);
    const t = await call('POST', '/talk', { text: 'Hi Ithil, want to help with the castle walls?' });
    assert.equal(t.status, 200);
    assert.ok(t.json.reply.length > 0);
    const msg = store.chat.items.find((m) => m.role === 'you');
    assert.equal(msg.from, 'Team lead', 'she knows who it came from');
    const task = await call('POST', '/tasks', { goal: 'Write notes on the gate', from: 'Team lead' });
    assert.equal(task.status, 202);
    assert.equal((await call('POST', '/tasks', { goal: 'Another thing' })).status, 409, 'busy');
    const got = await call('GET', '/tasks/' + task.json.taskId);
    assert.equal(got.json.status, 'working');
    assert.equal(store.tasks.items[0].by, 'command-center');
    assert.equal((await call('GET', '/avatar')).status, 404);
    assert.ok(link.view().connected);
  } finally { link.stop(); }
});

test('her live stream sends status first', async () => {
  const { link, key, base } = await setup();
  try {
    const first = await new Promise((resolve, reject) => {
      const req = http.get(base + '/events', { headers: { authorization: 'Bearer ' + key.token } }, (res) => {
        res.once('data', (d) => { resolve(d.toString()); req.destroy(); });
      });
      req.on('error', () => {});
      setTimeout(() => reject(new Error('no event')), 3000);
    });
    assert.match(first, /^event: status/);
  } finally { link.stop(); }
});

test('he can switch Command Center connections off', async () => {
  const { link, call, settings } = await setup();
  try {
    settings.setByUser({ allowCommandCenter: false });
    assert.equal((await call('GET', '/status')).status, 403);
  } finally { link.stop(); }
});

test('a new key locks out the old one', async () => {
  const { link, call, key } = await setup();
  try {
    link.newKey();
    assert.equal((await call('GET', '/status', null, key.token)).status, 401);
    assert.equal((await call('GET', '/status', null, link.token)).status, 200);
  } finally { link.stop(); }
});
