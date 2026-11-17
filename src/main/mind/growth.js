'use strict';
// Ithil's brain grows. Every few nights, while she sleeps, a LoRA is trained
// on her own saved life and loaded into Ollama as a new generation
// (ithil:gen-1, gen-2, ...). Each new generation is tested before she uses
// it; if it is worse, she keeps the one she has. Every generation is kept so
// the user can roll her back.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { newId } = require('./store');
const P = require('./prompts');

const UV_URL = 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-unknown-linux-gnu.tar.gz';
const TORCH_INDEX = 'https://download.pytorch.org/whl/cu128'; // RTX 50-series needs CUDA 12.8 builds
const PY_PACKAGES = ['transformers>=4.51', 'peft>=0.15', 'accelerate>=1.6', 'bitsandbytes>=0.46', 'huggingface_hub>=0.30', 'safetensors', 'sentencepiece', 'protobuf', 'numpy'];
const LLAMA_CPP = 'https://github.com/ggml-org/llama.cpp';
const BASE_REPO = { 'huihui_ai/qwen3-abliterated:8b-v2': 'huihui-ai/Huihui-Qwen3-8B-abliterated-v2', 'qwen3:8b': 'Qwen/Qwen3-8B' };

function lines(child, onLine) {
  let buf = '';
  const feed = (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l.trim()) onLine(l); }
  };
  child.stdout && child.stdout.on('data', feed);
  child.stderr && child.stderr.on('data', feed);
}

class Growth {
  constructor(mind, o) {
    this.mind = mind;
    this.store = mind.store;
    this.settings = mind.settings;
    this.o = o || {};
    this.root = this.store.p('trainer');
    this.status = null; // { stage, pct, msg }
    this.running = false;
    this.child = null;
    const st = this.settings.get();
    this.lineage = this.store.readState('brain-lineage', null) || {
      setupReady: false,
      generations: [{ gen: 0, model: st.chatModel, base: st.chatModel, at: mind.state.born, examples: 0, score: null, status: 'active', note: 'Starting brain' }]
    };
    this.stopFile = path.join(this.root, 'STOP');
  }
  save() { this.store.writeState('brain-lineage', this.lineage); }
  p(...x) { return path.join(this.root, ...x); }
  baseRepo() { const m = this.settings.get().chatModel; return BASE_REPO[m] || null; }
  active() { return this.lineage.generations.find((g) => g.status === 'active') || this.lineage.generations[0]; }
  setStatus(stage, pct, msg) { this.status = { stage, pct, msg: msg || '' }; this.mind.emit('update'); }

  // Which Ollama model she thinks with right now.
  activeModel() {
    const st = this.settings.get();
    const a = this.active();
    return a && a.gen > 0 && a.base === st.chatModel ? a.model : st.chatModel;
  }

  run(cmd, args, opts, onLine) {
    if (this.o.run) return this.o.run(cmd, args, opts, onLine);
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, Object.assign({ stdio: ['ignore', 'pipe', 'pipe'] }, opts || {}));
      this.child = child;
      let tail = '';
      lines(child, (l) => { tail = (tail + '\n' + l).slice(-2000); if (onLine) onLine(l); });
      child.on('error', (e) => reject(e));
      child.on('close', (code) => { this.child = null; code === 0 ? resolve() : reject(new Error(cmd.split('/').pop() + ' failed (' + code + '): ' + tail.split('\n').slice(-4).join(' ').slice(-400))); });
    });
  }

  py() { return this.p('venv', 'bin', 'python'); }
  trainScript() { return this.p('train.py'); }

  // One-time setup: uv, a Python env with CUDA PyTorch, llama.cpp's converter, and her base weights.
  async setup() {
    if (this.running) return { ok: false, reason: 'Already busy.' };
    const repo = this.baseRepo();
    if (!repo) return { ok: false, reason: 'Growing works with her starting brain models (' + Object.keys(BASE_REPO).join(', ') + '). Pick one of them as her brain model first.' };
    this.running = true;
    try {
      fs.mkdirSync(this.p('bin'), { recursive: true });
      const uv = this.p('bin', 'uv');
      if (!fs.existsSync(uv)) {
        this.setStatus('setup', 2, 'Getting the Python installer');
        const tgz = this.p('uv.tgz');
        const r = await fetch(UV_URL);
        if (!r.ok) throw new Error('Could not download uv');
        fs.writeFileSync(tgz, Buffer.from(await r.arrayBuffer()));
        await this.run('tar', ['-xzf', tgz, '-C', this.p('bin'), '--strip-components=1']);
        fs.rmSync(tgz, { force: true });
      }
      if (!fs.existsSync(this.py())) {
        this.setStatus('setup', 8, 'Making her training environment');
        await this.run(uv, ['venv', '--python', '3.12', this.p('venv')], { cwd: this.root });
      }
      this.setStatus('setup', 15, 'Installing PyTorch for the RTX 5070 (a few GB)');
      await this.run(uv, ['pip', 'install', '--python', this.py(), 'torch', '--index-url', TORCH_INDEX], { cwd: this.root }, (l) => this.setStatus('setup', 15, l.slice(0, 120)));
      this.setStatus('setup', 45, 'Installing training tools');
      await this.run(uv, ['pip', 'install', '--python', this.py()].concat(PY_PACKAGES), { cwd: this.root }, (l) => this.setStatus('setup', 45, l.slice(0, 120)));
      if (!fs.existsSync(this.p('llama.cpp', 'convert_lora_to_gguf.py'))) {
        this.setStatus('setup', 55, 'Getting the adapter converter (llama.cpp)');
        fs.rmSync(this.p('llama.cpp'), { recursive: true, force: true });
        await this.run('git', ['clone', '--depth', '1', LLAMA_CPP, this.p('llama.cpp')]);
      }
      fs.copyFileSync(path.join(__dirname, '..', 'trainer', 'train.py'), this.trainScript());
      this.setStatus('setup', 60, 'Downloading her base brain weights (about 16 GB)');
      await this.run(this.py(), [this.trainScript(), 'download', '--base-repo', repo, '--base-dir', this.p('base', repo.replace('/', '__')), '--hf-token', this.settings.get().hfToken || ''], { cwd: this.root, env: Object.assign({}, process.env, { HF_HUB_ENABLE_HF_TRANSFER: '0' }) },
        (l) => { try { const j = JSON.parse(l); if (j.stage === 'error') throw new Error(j.msg); } catch (e) { if (/failed|error/i.test(e.message)) throw e; } this.setStatus('setup', 75, 'Downloading base weights…'); });
      this.lineage.setupReady = true;
      this.lineage.setupRepo = repo;
      this.save();
      this.setStatus('ready', 100, 'Ready to grow');
      return { ok: true };
    } catch (e) {
      this.setStatus('error', null, String(e.message || e));
      return { ok: false, reason: String(e.message || e) };
    } finally { this.running = false; }
  }

  examplesSince(t) {
    const dir = this.store.p('training');
    let n = 0;
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.jsonl')) continue;
        const full = path.join(dir, f);
        if (fs.statSync(full).mtimeMs < t) continue;
        n += fs.readFileSync(full, 'utf8').split('\n').filter(Boolean).length;
      }
    } catch (_) {}
    return n;
  }

  canGrowTonight() {
    const st = this.settings.get();
    if (!st.growWhileSleeping || !this.lineage.setupReady || this.running) return { ok: false };
    if (this.lineage.setupRepo !== this.baseRepo()) return { ok: false, reason: 'Her brain model changed since setup.' };
    const last = this.lineage.generations[this.lineage.generations.length - 1];
    const days = (this.mind.now() - (last.at || 0)) / 86400000;
    if (days < (st.growEveryDays || 3)) return { ok: false, reason: 'Not time yet.' };
    const fresh = this.examplesSince(last.at || 0);
    if (fresh < 150) return { ok: false, reason: 'Not enough new life yet (' + fresh + ').' };
    return { ok: true };
  }

  // Train, convert, load into Ollama, test, and keep it only if it's good.
  async grow(by) {
    if (this.running) return { ok: false, reason: 'Already growing.' };
    if (!this.lineage.setupReady) return { ok: false, reason: 'Set up growing first.' };
    this.running = true;
    const st = this.settings.get();
    const gen = Math.max(...this.lineage.generations.map((g) => g.gen)) + 1;
    const dir = this.store.p('brain', 'gen-' + gen);
    fs.mkdirSync(dir, { recursive: true });
    fs.rmSync(this.stopFile, { force: true });
    const repo = this.lineage.setupRepo;
    const baseDir = this.p('base', repo.replace('/', '__'));
    let watch = null;
    try {
      this.mind.moment('Started growing a new brain (generation ' + gen + ').', 'self');
      await this.mind.brain.unload();
      // Stop training if he starts gaming.
      if (this.mind.body && st.unloadWhenGaming) {
        watch = setInterval(async () => {
          try { const g = await this.mind.body.gaming(); if (g.gaming && g.apps.length) fs.writeFileSync(this.stopFile, 'gpu needed'); } catch (_) {}
        }, 30000);
      }
      const onLine = (l) => {
        let j; try { j = JSON.parse(l); } catch (_) { return; }
        if (j.stage === 'error') this._err = j.msg;
        else this.setStatus(j.stage, j.pct, j.msg);
      };
      this._err = null;
      this.setStatus('train', 0, 'Reading her life');
      await this.run(this.py(), [this.trainScript(), 'train', '--base-dir', baseDir, '--data-dir', this.store.p('training'), '--out-dir', dir, '--stop-file', this.stopFile], { cwd: this.root }, onLine)
        .catch((e) => { throw new Error(this._err || (fs.existsSync(this.stopFile) ? 'Stopped: the GPU was needed.' : e.message)); });
      await this.run(this.py(), [this.trainScript(), 'gguf', '--base-dir', baseDir, '--out-dir', dir, '--llama-cpp', this.p('llama.cpp')], { cwd: this.root }, onLine)
        .catch((e) => { throw new Error(this._err || e.message); });
      this.setStatus('load', 0, 'Loading generation ' + gen + ' into Ollama');
      const model = 'ithil:gen-' + gen;
      await this.ollamaCreate(model, st.chatModel, path.join(dir, 'adapter.gguf'));
      let info = {};
      try { info = JSON.parse(fs.readFileSync(path.join(dir, 'train-info.json'), 'utf8')); } catch (_) {}
      this.setStatus('test', 0, 'Testing generation ' + gen);
      const score = await this.evaluate(model);
      const prev = this.active();
      const prevScore = prev.score == null ? await this.evaluate(prev.model).then((s) => { prev.score = s.score; return s.score; }) : prev.score;
      const entry = { gen, model, base: st.chatModel, at: this.mind.now(), examples: info.examples || 0, score: score.score, detail: score, by: by || 'sleep' };
      if (score.json >= 0.85 && score.identity && score.score >= prevScore - 0.05) {
        for (const g of this.lineage.generations) if (g.status === 'active') g.status = 'kept';
        entry.status = 'active';
        entry.note = 'Better or as good as gen ' + prev.gen;
        this.lineage.generations.push(entry);
        this.save();
        // 0.6: make her new brain ready for Colibri too. Never stops her growing if it fails.
        await this.forColibri(entry, dir, baseDir);
        this.mind.state.brain = { generation: gen, base: st.chatModel, model, history: (this.mind.state.brain.history || []).concat([{ generation: gen, model, at: entry.at }]) };
        await this.mind.memory.remember({ kind: 'event', weight: 'core', text: 'I grew a new brain from my own life. I’m generation ' + gen + ' now.' });
        this.mind.moment('Woke up as generation ' + gen + '.', 'self');
        this.setStatus('done', 100, 'She is generation ' + gen + ' now');
        return { ok: true, gen, score };
      }
      entry.status = 'rejected';
      entry.note = score.json < 0.85 ? 'Lost her ability to answer in the right format' : !score.identity ? 'Forgot who she is' : 'Scored lower than gen ' + prev.gen;
      this.lineage.generations.push(entry);
      this.save();
      this.mind.moment('Tried to grow generation ' + gen + ' but it came out worse (' + entry.note.toLowerCase() + '). Kept my current brain.', 'self');
      this.setStatus('done', 100, 'Kept gen ' + prev.gen + ': ' + entry.note);
      return { ok: false, reason: entry.note, gen, score };
    } catch (e) {
      const msg = String(e.message || e);
      this.mind.moment('Couldn’t finish growing: ' + msg.slice(0, 160), 'self');
      this.setStatus('error', null, msg);
      return { ok: false, reason: msg };
    } finally {
      if (watch) clearInterval(watch);
      fs.rmSync(this.stopFile, { force: true });
      this.running = false;
    }
  }

  // 0.6: her grown brain in Colibri. Colibri can't load an Ollama LoRA adapter, so the adapter is merged into her
  // base weights, written as one GGUF (q8_0, about 9 GB) and imported with `coli import` (it reads the GGUF in place).
  // Colibri serves one model at a time and belongs to him (or to Hearth OS): she only gets it ready, the owner points
  // Colibri at it (Settings › Her brain › Use with Colibri). Docs: docs/colibri.md.
  async forColibri(entry, dir, baseDir) {
    const st = this.settings.get();
    if (st.growForColibri === false || st.brainEngine === 'ollama') return null;
    const { findColi } = require('./engines');
    const coli = this.o.coli !== undefined ? this.o.coli : findColi(st);
    if (!coli) { entry.colibri = { ok: false, why: 'Colibri’s coli command isn’t installed' }; this.save(); return null; }
    const name = 'ithil-gen-' + entry.gen;
    const gguf = path.join(dir, name + '-q8_0.gguf');
    const out = path.join(dir, name);
    try {
      this.setStatus('colibri', 0, 'Making generation ' + entry.gen + ' ready for Colibri');
      await this.run(this.py(), [this.trainScript(), 'merged', '--base-dir', baseDir, '--out-dir', dir, '--llama-cpp', this.p('llama.cpp'), '--gguf-name', path.basename(gguf)], { cwd: this.root }, (l) => { let j; try { j = JSON.parse(l); } catch (_) { return; } if (j.stage !== 'error') this.setStatus('colibri', j.pct, j.msg); else this._err = j.msg; });
      await this.run(coli, ['import', gguf, '--out', out], { cwd: dir });
      entry.colibri = { ok: true, dir: out, gguf, model: name, at: this.mind.now() };
      this.mind.moment('Generation ' + entry.gen + ' of my brain is ready for Colibri too.', 'self');
    } catch (e) {
      entry.colibri = { ok: false, why: String(this._err || e.message || e).slice(0, 300) };
    }
    this.save();
    return entry.colibri;
  }

  // Her grown generations that are ready for Colibri (for Settings › Her brain).
  colibriReady() { return this.lineage.generations.filter((g) => g.colibri && g.colibri.ok && g.status !== 'rejected').map((g) => ({ gen: g.gen, dir: g.colibri.dir, model: g.colibri.model })); }

  stop() { try { fs.mkdirSync(this.root, { recursive: true }); fs.writeFileSync(this.stopFile, 'stopped by user'); } catch (_) {} }

  async ollamaCreate(model, from, adapterFile) {
    if (this.o.ollamaCreate) return this.o.ollamaCreate(model, from, adapterFile);
    const url = (this.settings.get().ollamaUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
    const buf = fs.readFileSync(adapterFile);
    const digest = 'sha256:' + crypto.createHash('sha256').update(buf).digest('hex');
    const up = await fetch(url + '/api/blobs/' + digest, { method: 'POST', body: buf });
    if (!up.ok && up.status !== 200 && up.status !== 201) throw new Error('Ollama refused the adapter upload (' + up.status + ')');
    const r = await fetch(url + '/api/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, from, adapters: { 'adapter.gguf': digest }, stream: false }) });
    if (!r.ok) throw new Error('Ollama could not create ' + model + ': ' + (await r.text()).slice(0, 200));
  }

  // Test a brain: can it still do her jobs in the right format, does it know
  // who it is, and can it pick out its own thoughts?
  async evaluate(model) {
    if (this.o.evaluate) return this.o.evaluate(model);
    const brain = this.mind.brain;
    const held = this.heldOut(12);
    let ok = 0;
    for (const ex of held) {
      try {
        const r = await brain.chat([{ role: 'system', content: ex.system }, { role: 'user', content: ex.user }], { model, json: true, think: false, temperature: 0.3, timeoutMs: 120000 });
        if (r && typeof r === 'object' && Object.keys(r).length) ok++;
      } catch (_) {}
    }
    const json = held.length ? ok / held.length : 1;
    let identity = false;
    try {
      const who = await brain.chat([{ role: 'system', content: P.identity(this.mind.state) }, { role: 'user', content: 'Who are you, in one sentence?' }], { model, think: false, temperature: 0.3 });
      identity = new RegExp(this.mind.state.name, 'i').test(who);
    } catch (_) {}
    let mirror = 0.5;
    try {
      const { mirrorTest } = require('./sleep');
      const m = await mirrorTest(this.mind, { model });
      if (m) mirror = m.right / m.total;
    } catch (_) {}
    await brain.unload().catch(() => {});
    const score = Math.round((json * 0.6 + mirror * 0.3 + (identity ? 0.1 : 0)) * 100) / 100;
    return { score, json: Math.round(json * 100) / 100, mirror: Math.round(mirror * 100) / 100, identity };
  }

  heldOut(n) {
    const dir = this.store.p('training');
    const out = [];
    try {
      const files = fs.readdirSync(dir).filter((f) => f.startsWith('exchanges-')).sort().reverse();
      for (const f of files) {
        const rows = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).reverse();
        for (const l of rows) {
          try { const j = JSON.parse(l); if (j.messages && j.messages.length >= 3) out.push({ system: j.messages[0].content, user: j.messages[1].content }); } catch (_) {}
          if (out.length >= n) return out;
        }
      }
    } catch (_) {}
    return out;
  }

  // Only the user calls this, from Settings.
  useGeneration(gen) {
    const g = this.lineage.generations.find((x) => x.gen === gen);
    if (!g || g.status === 'rejected') return { ok: false };
    for (const x of this.lineage.generations) if (x.status === 'active') x.status = 'kept';
    g.status = 'active';
    this.save();
    this.mind.state.brain = Object.assign({}, this.mind.state.brain, { generation: g.gen, model: g.model, base: g.base });
    this.mind.moment('He switched my brain to generation ' + gen + '.', 'self');
    this.mind.save();
    return { ok: true };
  }

  view() {
    const fmt = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const can = this.canGrowTonight();
    const last = this.lineage.generations[this.lineage.generations.length - 1];
    return {
      setupReady: !!this.lineage.setupReady,
      running: this.running,
      status: this.status,
      supported: !!this.baseRepo(),
      nextNote: !this.lineage.setupReady ? 'Set up growing to start.' : can.ok ? 'She grows during her next sleep.' : (can.reason || 'Growing is off.'),
      newExamples: this.examplesSince(last.at || 0),
      generations: this.lineage.generations.slice().reverse().map((g) => ({ gen: g.gen, model: g.model, born: fmt(g.at), examples: g.examples, score: g.score == null ? '—' : Math.round(g.score * 100) + '%', status: g.status, note: g.note || '', colibri: g.colibri ? (g.colibri.ok ? 'ready for Colibri' : 'not for Colibri: ' + g.colibri.why) : '' }))
    };
  }
}

module.exports = { Growth, BASE_REPO };
