'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Comfy } = require('../src/main/comfy');

function fakeComfy(failAt) {
  const prompts = [];
  let uploads = 0, n = 0;
  const server = http.createServer((req, res) => {
    let body = [];
    req.on('data', (c) => body.push(c));
    req.on('end', () => {
      body = Buffer.concat(body);
      const u = new URL(req.url, 'http://x');
      const json = (o, code) => { res.writeHead(code || 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (u.pathname === '/object_info/CheckpointLoaderSimple') return json({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [['animeXL.safetensors']] } } } });
      if (u.pathname === '/upload/image') { uploads++; return json({ name: 'base.png' }); }
      if (u.pathname === '/prompt') {
        n++;
        if (failAt && n === failAt) return json({ error: 'boom' }, 500);
        prompts.push(JSON.parse(body.toString()).prompt);
        return json({ prompt_id: 'p' + n });
      }
      if (u.pathname.startsWith('/history/')) {
        const id = u.pathname.split('/').pop();
        return json({ [id]: { outputs: { 9: { images: [{ filename: id + '.png', subfolder: '', type: 'output' }] } } } });
      }
      if (u.pathname === '/view') { res.writeHead(200); return res.end(Buffer.from('PNG-' + u.searchParams.get('filename'))); }
      json({}, 404);
    });
  });
  return new Promise((r) => server.listen(0, () => r({ server, prompts, uploads: () => uploads, url: 'http://127.0.0.1:' + server.address().port })));
}

const av = { style: 'Anime', hair: 'Silver, long', eyes: 'Pale blue', outfit: 'Dark cloak, moon pin', nightOutfit: 'Same as day', accent: 'Hearth sage' };

test('her face set comes from one base portrait, zoomed out, swapped in at the end', async () => {
  const f = await fakeComfy();
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'av-')), 'avatar');
  fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'calm.png'), 'OLD');
  const c = new Comfy(() => ({ comfyUrl: f.url, comfyCheckpoint: '' }));
  const files = await c.drawAvatar(av, dir);
  f.server.close();
  assert.equal(files.length, 9);
  assert.equal(f.uploads(), 1, 'base portrait uploaded once');
  assert.ok(!f.prompts[0]['10'], 'first picture is drawn fresh');
  for (const p of f.prompts.slice(1)) {
    assert.equal(p['10'].inputs.image, 'base.png', 'every other face starts from the base');
    assert.ok(p['3'].inputs.denoise < 0.6);
  }
  assert.match(f.prompts[0]['6'].inputs.text, /whole head/);
  assert.match(f.prompts[0]['7'].inputs.text, /cropped head/);
  assert.notEqual(fs.readFileSync(path.join(dir, 'calm.png'), 'utf8'), 'OLD');
  assert.ok(!fs.existsSync(dir + '.new') && !fs.existsSync(dir + '.old'));
});

test('if drawing fails halfway, her old face stays untouched', async () => {
  const f = await fakeComfy(4);
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'av-')), 'avatar');
  fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'calm.png'), 'OLD');
  const c = new Comfy(() => ({ comfyUrl: f.url, comfyCheckpoint: '' }));
  await assert.rejects(c.drawAvatar(av, dir));
  f.server.close();
  assert.equal(fs.readFileSync(path.join(dir, 'calm.png'), 'utf8'), 'OLD');
  assert.ok(!fs.existsSync(dir + '.new'));
});
