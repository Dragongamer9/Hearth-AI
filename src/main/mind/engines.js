'use strict';
// 0.6: Ithil's brain engines. Colibri (https://github.com/JustVugg/colibri, OpenAI-compatible, `coli serve`) is her
// brain; Ollama is the fallback. The router below sends each request to Colibri first and, if Colibri isn't
// installed, isn't running, stops answering (also halfway through an answer) or the model errors, sends the same
// request to Ollama. Every request carries her whole context, so the switch is seamless mid-conversation; every
// switch is logged. Memory search (embeddings) always uses Ollama: Colibri has no embeddings endpoint.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { extractJSON } = require('./llm');

const DEFAULT_COLIBRI = 'http://127.0.0.1:8000/v1';

// ---------- where Colibri is ----------

// Hearth OS (Server mode) writes its engines and their addresses to ~/.config/nimbus/ai-engines.json. Read it
// leniently: {engines:[{id, baseUrl}]}, {engines:{colibri:{…}}}, [{…}] or {colibri:{…}}; baseUrl / base_url / url /
// openaiBaseUrl, or just a port. Never written here: it belongs to Hearth OS.
function registryFile(env) {
  const e = env || process.env;
  return e.HEARTH_AI_ENGINES || path.join(e.HOME || os.homedir(), '.config', 'nimbus', 'ai-engines.json');
}

function normUrl(u, port) {
  let s = String(u || '').trim();
  if (!s && port) s = 'http://127.0.0.1:' + Number(port);
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  s = s.replace(/\/+$/, '');
  if (!/\/v1$/.test(s)) s += '/v1';
  return s;
}

function readRegistry(file) {
  const f = file || registryFile();
  let raw;
  try { raw = fs.readFileSync(f, 'utf8'); } catch (_) { return { ok: false, file: f, engines: [], why: 'not there' }; }
  let j;
  try { j = JSON.parse(raw); } catch (e) { return { ok: false, file: f, engines: [], why: 'could not be read' }; }
  let list = [];
  if (Array.isArray(j)) list = j;
  else if (j && Array.isArray(j.engines)) list = j.engines;
  else if (j && j.engines && typeof j.engines === 'object') list = Object.keys(j.engines).map((k) => Object.assign({ id: k }, j.engines[k]));
  else if (j && typeof j === 'object') list = Object.keys(j).filter((k) => j[k] && typeof j[k] === 'object').map((k) => Object.assign({ id: k }, j[k]));
  const engines = list.filter((x) => x && typeof x === 'object').map((x) => ({
    id: String(x.id || x.engine || x.name || '').toLowerCase(),
    name: x.name || x.id || '',
    baseUrl: normUrl(x.baseUrl || x.base_url || x.openaiBaseUrl || x.openai_base_url || x.url, x.port),
    model: x.model || x.modelId || null,
    managedBy: x.managedBy || x.service || 'hearth-os',
    cli: x.cli || x.coli || null,
    enabled: x.enabled !== false
  }));
  return { ok: true, file: f, engines };
}

// Where to reach Colibri: his own setting first, then Hearth OS's registry, then HEARTH_COLIBRI_URL, then the default.
function findColibri(settings, env, regFile) {
  const s = settings || {};
  if (s.colibriUrl && String(s.colibriUrl).trim()) return { url: normUrl(s.colibriUrl), source: 'your setting', managed: false, entry: null };
  const reg = readRegistry(regFile || registryFile(env));
  const hit = reg.engines.find((x) => /colibri/.test(x.id) && x.enabled && x.baseUrl);
  if (hit) return { url: hit.baseUrl, source: 'Hearth OS (' + path.basename(reg.file) + ')', managed: true, entry: hit };
  const e = env || process.env;
  if (e.HEARTH_COLIBRI_URL) return { url: normUrl(e.HEARTH_COLIBRI_URL), source: 'HEARTH_COLIBRI_URL', managed: false, entry: null };
  return { url: DEFAULT_COLIBRI, source: 'default', managed: false, entry: null };
}

// ---------- errors ----------

class EngineError extends Error {
  // kind: 'down' (not installed / not running / stalled / broke mid-answer / 5xx) puts Colibri on a short rest;
  // 'request' (this request needs something the model can't do: tools, pictures, a format) falls back once.
  constructor(msg, kind, status) { super(msg); this.kind = kind || 'down'; this.status = status || 0; }
}

function stripThink(t) { return String(t || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^[\s\S]*?<\/think>/, '').trim(); }

// Ollama-style messages ({role, content, images:[base64]}) to OpenAI's (content parts with image_url).
function toOpenAI(messages) {
  return messages.map((m) => {
    if (!m.images || !m.images.length) { const o = { role: m.role, content: m.content }; if (m.tool_calls) o.tool_calls = m.tool_calls; if (m.tool_call_id) o.tool_call_id = m.tool_call_id; return o; }
    return { role: m.role, content: [{ type: 'text', text: String(m.content || '') }].concat(m.images.map((b) => ({ type: 'image_url', image_url: { url: /^data:/.test(b) ? b : 'data:image/png;base64,' + b } }))) };
  });
}
const hasImages = (messages) => messages.some((m) => m.images && m.images.length);

function parseArgs(a) { if (a && typeof a === 'object') return a; try { return JSON.parse(a || '{}'); } catch (_) { return { _raw: String(a || '') }; } }

// ---------- Colibri ----------

class ColibriBrain {
  constructor(getSettings, o) {
    this.getSettings = getSettings;
    this.o = o || {};
    this.fetch = this.o.fetch || ((...a) => fetch(...a));
    this.info = null;          // last /v1/models answer: { model, vision, contextLength, at }
    this.lastError = null;
    this.stats = { tokensPerSec: null, tokens: 0, ms: 0, at: 0 };
    this.busy = 0;
  }
  where() { return findColibri(this.getSettings(), this.o.env, this.o.registryFile); }
  get url() { return this.where().url; }

  async _get(p, ms) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms || 3000);
    try { return await this.fetch(this.url + p, { signal: ctl.signal }); } finally { clearTimeout(t); }
  }

  // Is Colibri there, and which model does it serve? (Colibri serves one model at a time.)
  async available() {
    const w = this.where();
    try {
      const r = await this._get('/models', 3000);
      if (!r.ok) { this.info = null; return { ok: false, url: w.url, source: w.source, managed: w.managed, error: 'Colibri answered ' + r.status }; }
      const j = await r.json();
      const m = (j.data || [])[0] || {};
      const caps = m.capabilities || ['chat'];
      this.info = { model: m.id || null, vision: (m.input_modalities || []).includes('image'), chat: caps.includes('chat'), contextLength: m.context_length || null, at: Date.now() };
      return { ok: !!m.id && this.info.chat, url: w.url, source: w.source, managed: w.managed, model: this.info.model, vision: this.info.vision, contextLength: this.info.contextLength, models: (j.data || []).map((x) => x.id), error: this.info.chat ? null : 'the model Colibri serves doesn’t chat' };
    } catch (e) {
      this.info = null;
      return { ok: false, url: w.url, source: w.source, managed: w.managed, error: /abort/i.test(String(e && e.name) + String(e && e.message)) ? 'not answering' : 'not running (' + String(e.cause && e.cause.code || e.message || e).slice(0, 60) + ')' };
    }
  }

  async servedModel() {
    if (!this.info || Date.now() - this.info.at > 60000) await this.available();
    if (!this.info || !this.info.model) throw new EngineError('Colibri isn’t serving a model', 'down');
    return this.info.model;
  }

  // Same shape as OllamaBrain.chat: text, or an object with o.json, or { content, toolCalls } with o.tools.
  // It always streams, so tokens/s is measured and a break halfway through an answer is caught.
  async chat(messages, opts) {
    const o = opts || {};
    this.busy++;
    try {
      const model = await this.servedModel();
      if (hasImages(messages) && !this.info.vision) throw new EngineError('Colibri’s model can’t see pictures', 'request');
      const body = { model, messages: toOpenAI(messages), stream: true, stream_options: { include_usage: true }, temperature: o.temperature == null ? 0.8 : o.temperature };
      if (o.think === false) body.enable_thinking = false;
      if (o.json) body.response_format = { type: 'json_object' };
      if (o.tools && o.tools.length) body.tools = o.tools;
      if (o.maxTokens) body.max_tokens = o.maxTokens;
      let r;
      try { r = await this._stream(body, o); }
      catch (e) {
        // A model whose engine refuses JSON mode still answers in JSON when asked to; try once without it.
        if (e.kind === 'request' && o.json && /response_format/i.test(e.message)) { delete body.response_format; r = await this._stream(body, o); }
        else if (e.status === 404 && /model/i.test(e.message)) { this.info = null; body.model = await this.servedModel(); r = await this._stream(body, o); }
        else throw e;
      }
      this.lastError = null;
      const content = stripThink(r.content);
      if (o.tools) return { content, toolCalls: r.toolCalls };
      if (o.json) {
        const j = extractJSON(content);
        if (!j) throw new EngineError('Colibri’s answer wasn’t JSON', 'request');
        return j;
      }
      return content;
    } catch (e) {
      this.lastError = String(e.message || e);
      throw e instanceof EngineError ? e : new EngineError(String(e.message || e), 'down');
    } finally { this.busy--; }
  }

  async _stream(body, o) {
    const ctl = new AbortController();
    const total = setTimeout(() => ctl.abort(new Error('timed out')), o.timeoutMs || 180000);
    const idleMs = o.idleMs || this.o.idleMs || 60000;
    let idle = null;
    const poke = () => { clearTimeout(idle); idle = setTimeout(() => ctl.abort(new Error('stalled')), idleMs); };
    const t0 = Date.now();
    let firstAt = 0;
    try {
      poke();
      let res;
      try {
        res = await this.fetch(this.url + '/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
      } catch (e) { throw new EngineError('Colibri isn’t running (' + String(e.cause && e.cause.code || e.message || e).slice(0, 80) + ')', 'down'); }
      if (!res.ok) {
        const txt = (await res.text().catch(() => '')).slice(0, 300);
        let msg = txt; try { const j = JSON.parse(txt); msg = (j.error && (j.error.message || j.error)) || txt; } catch (_) {}
        throw new EngineError('Colibri ' + res.status + ': ' + msg, res.status >= 500 || res.status === 429 ? 'down' : 'request', res.status);
      }
      if (!res.body) throw new EngineError('Colibri sent no answer', 'down');
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '', content = '', done = false, finish = null, usage = null, chunks = 0;
      const calls = [];
      for (;;) {
        let part;
        try { part = await reader.read(); } catch (e) { throw new EngineError('Colibri stopped halfway through an answer (' + String(e.message || e).slice(0, 60) + ')', 'down'); }
        if (part.done) break;
        poke();
        buf += dec.decode(part.value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') { done = true; continue; }
          let j; try { j = JSON.parse(data); } catch (_) { continue; }
          if (j.error) throw new EngineError('Colibri: ' + (j.error.message || JSON.stringify(j.error)).slice(0, 200), 'down');
          if (j.usage) usage = j.usage;
          const c = (j.choices || [])[0];
          if (!c) continue;
          const d = c.delta || {};
          if (d.content) {
            if (!firstAt) firstAt = Date.now();
            chunks++;
            content += d.content;
            if (o.onToken) { try { o.onToken(d.content); } catch (_) {} }
          }
          for (const tc of d.tool_calls || []) {
            const k = tc.index == null ? calls.length : tc.index;
            calls[k] = calls[k] || { id: tc.id || '', name: '', args: '' };
            if (tc.id) calls[k].id = tc.id;
            if (tc.function && tc.function.name) calls[k].name += tc.function.name;
            if (tc.function && tc.function.arguments) calls[k].args += typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments);
          }
          if (c.finish_reason) finish = c.finish_reason;
        }
      }
      if (!done && !finish) throw new EngineError('Colibri stopped halfway through an answer', 'down');
      // From the first token to the last (the whole request if it all came at once).
      const ms = Math.max(1, Date.now() - (firstAt || t0)) < 5 ? Math.max(1, Date.now() - t0) : Date.now() - (firstAt || t0);
      const tokens = (usage && usage.completion_tokens) || chunks;
      this.stats = { tokensPerSec: tokens && ms > 0 ? Math.round((tokens / (ms / 1000)) * 10) / 10 : null, tokens, ms: Date.now() - t0, at: Date.now() };
      return { content, finish, toolCalls: calls.filter(Boolean).map((x) => ({ id: x.id, name: x.name, arguments: parseArgs(x.args) })) };
    } catch (e) {
      if (e instanceof EngineError) throw e;
      const why = ctl.signal.aborted ? String((ctl.signal.reason && ctl.signal.reason.message) || 'stopped') : String(e.message || e);
      throw new EngineError('Colibri ' + (why === 'stalled' ? 'stopped answering' : why), 'down');
    } finally { clearTimeout(total); clearTimeout(idle); }
  }

  async see(imageBase64, prompt) {
    return this.chat([{ role: 'user', content: prompt, images: [imageBase64] }], { think: false, temperature: 0.3 });
  }
}

// ---------- the router: Colibri first, Ollama as the fallback ----------

const REST_MS = [30000, 60000, 120000, 300000];

class BrainRouter {
  // o: { getSettings, colibri, ollama, grownModel: () => 'ithil:gen-N' | null, colibriServes: () => bool, onSwitch(entry), now }
  constructor(o) {
    this.o = o;
    this.getSettings = o.getSettings;
    this.colibri = o.colibri;
    this.ollama = o.ollama;
    this.now = o.now || (() => Date.now());
    this.onExchange = null;
    this.answering = null;       // 'colibri' | 'ollama'
    this.lastModel = null;
    this.switches = [];          // the last 50 switches, newest last
    this.restUntil = 0;          // Colibri rests after it fails, then is tried again
    this.fails = 0;
    this.lastReason = null;
    this.lastCheck = { colibri: null, ollama: null };
  }
  mode() { return this.getSettings().brainEngine === 'ollama' ? 'ollama' : 'colibri'; }
  get loaded() { return this.ollama.loaded || this.answering === 'colibri'; }
  get lastError() { return this.answering === 'colibri' ? this.colibri.lastError : this.ollama.lastError; }
  get busy() { return (this.ollama.busy || 0) + (this.colibri.busy || 0); }
  get url() { return this.ollama.url; }
  get model() { return this.ollama.model; }

  // Which engines to try for this request, in order, and why Colibri was left out if it was.
  plan(messages, o) {
    if (this.mode() === 'ollama') return { order: ['ollama'], why: 'Ollama only (your setting)' };
    if (o && o.model) return { order: ['ollama'], why: 'a test of one of her own brains in Ollama' };
    const grown = this.o.grownModel ? this.o.grownModel() : null;
    if (grown && this.getSettings().preferGrownBrain !== false && !(this.o.colibriServes && this.o.colibriServes())) return { order: ['ollama'], why: 'her grown brain (' + grown + ') runs in Ollama' };
    if (this.now() < this.restUntil) return { order: ['ollama'], why: this.lastReason || 'Colibri isn’t answering' };
    if (hasImages(messages) && this.colibri.info && !this.colibri.info.vision) return { order: ['ollama'], why: 'Colibri’s model can’t see pictures', once: true };
    return { order: ['colibri', 'ollama'], why: null };
  }

  _switch(to, why) {
    if (this.answering === to) return;
    const entry = { at: this.now(), from: this.answering, to, why: why || '' };
    this.answering = to;
    this.switches.push(entry);
    if (this.switches.length > 50) this.switches.shift();
    if (this.o.onSwitch) { try { this.o.onSwitch(entry); } catch (_) {} }
  }

  async chat(messages, opts) {
    const o = opts || {};
    const p = this.plan(messages, o);
    let why = p.why, lastErr = null;
    for (let i = 0; i < p.order.length; i++) {
      const eng = p.order[i];
      try {
        let r;
        if (eng === 'colibri') r = await this.colibri.chat(messages, o);
        else {
          const oo = hasImages(messages) && !o.model ? Object.assign({}, o, { model: this.getSettings().visionModel || o.model }) : o;
          r = await this.ollama.chat(messages, oo);
        }
        if (eng === 'colibri') { this.fails = 0; this.restUntil = 0; this.lastReason = null; }
        // A request that went to Ollama only because of what it needs (a picture) doesn't count as a switch.
        if (!(p.once && eng === 'ollama')) this._switch(eng, eng === 'colibri' ? (this.switches.length ? 'Colibri is answering again' : 'Colibri is answering') : why);
        this.lastModel = eng === 'colibri' ? (this.colibri.info && this.colibri.info.model) : (o.model || this.ollama.model);
        return r;
      } catch (e) {
        lastErr = e;
        if (eng === 'colibri') {
          why = 'Colibri: ' + String(e.message || e).replace(/^Colibri:?\s*/, '').slice(0, 140);
          if (!e.kind || e.kind === 'down') {
            this.restUntil = this.now() + REST_MS[Math.min(this.fails, REST_MS.length - 1)];
            this.fails++;
            this.lastReason = why;
          }
          // Anything streamed so far is thrown away: Ollama answers the whole request again.
          if (o.onToken) { try { o.onToken('', { reset: true }); } catch (_) {} }
          continue;
        }
        throw e;
      }
    }
    throw lastErr || new Error('No brain answered');
  }

  async json(system, user, opts) {
    const r = await this.chat([{ role: 'system', content: system }, { role: 'user', content: user }], Object.assign({ json: true, think: false }, opts || {}));
    // Her real answers become training data for her own future brain (from either engine).
    if (this.onExchange && !(opts && opts.model) && r && Object.keys(r).length) { try { this.onExchange(system, user, r); } catch (_) {} }
    return r;
  }

  embed(texts) { return this.ollama.embed(texts); }
  pull(model, onProgress) { return this.ollama.pull(model, onProgress); }
  // Colibri has no unload call; its experts stay where its own planner put them (see docs/colibri.md).
  unload() { return this.ollama.unload(); }

  async see(imageBase64, prompt) {
    const viaColibri = this.mode() === 'colibri' && this.now() >= this.restUntil && this.colibri.info && this.colibri.info.vision;
    if (viaColibri) {
      try { const r = await this.colibri.see(imageBase64, prompt); return r; } catch (_) { /* her sight model in Ollama sees instead */ }
    }
    return this.ollama.see(imageBase64, prompt);
  }

  // Both engines, for the screens and checkServices.
  async available() {
    const [c, l] = await Promise.all([this.mode() === 'colibri' ? this.colibri.available() : Promise.resolve(null), this.ollama.available()]);
    this.lastCheck = { colibri: c, ollama: l, at: this.now() };
    if (c && c.ok && this.now() < this.restUntil && this.fails > 0) { this.restUntil = 0; }
    return { ok: !!(c && c.ok) || !!l.ok, models: l.models || [], ollama: l, colibri: c };
  }

  stats() {
    const st = this.answering === 'colibri' ? this.colibri.stats : this.ollama.stats;
    return st || { tokensPerSec: null };
  }

  status() {
    const s = this.getSettings();
    const c = this.lastCheck.colibri, l = this.lastCheck.ollama;
    const p = this.plan([], {});
    return {
      mode: this.mode(),
      answering: this.answering || p.order[0],
      model: this.lastModel || (p.order[0] === 'colibri' ? (c && c.model) : this.ollama.model),
      tokensPerSec: this.stats().tokensPerSec,
      why: p.order[0] === 'ollama' ? p.why : null,
      colibri: c ? { ok: c.ok, url: c.url, source: c.source, managed: c.managed, model: c.model || null, vision: !!c.vision, error: c.error || null, wanted: s.colibriModel || '' } : { ok: false, off: true, url: this.colibri.url },
      ollama: l ? { ok: l.ok, url: this.ollama.url, model: this.ollama.model, error: l.error || null } : { ok: null, url: this.ollama.url, model: this.ollama.model },
      restingUntil: this.restUntil > this.now() ? this.restUntil : null,
      switches: this.switches.slice(-8).reverse()
    };
  }

  // Settings › Her brain › Test: a tiny real answer from each engine, timed.
  async test() {
    const ask = [{ role: 'system', content: 'You are Ithil. Answer in a few words.' }, { role: 'user', content: 'Say hello in five words or fewer.' }];
    const out = [];
    for (const eng of this.mode() === 'colibri' ? ['colibri', 'ollama'] : ['ollama']) {
      const b = eng === 'colibri' ? this.colibri : this.ollama;
      const t0 = Date.now();
      try {
        const reply = await b.chat(ask, { think: false, temperature: 0.2, timeoutMs: 90000 });
        out.push({ engine: eng, ok: true, ms: Date.now() - t0, tokensPerSec: (b.stats && b.stats.tokensPerSec) || null, model: eng === 'colibri' ? (b.info && b.info.model) : b.model, reply: String(reply).slice(0, 120) });
        if (eng === 'colibri') { this.restUntil = 0; this.fails = 0; this.lastReason = null; }
      } catch (e) { out.push({ engine: eng, ok: false, ms: Date.now() - t0, error: String(e.message || e).slice(0, 160) }); }
    }
    return out;
  }
}

// ---------- Colibri's model catalog (every model it offers, marked for this PC) ----------

// A copy of Colibri's catalog (c/setup_catalog.py, sizes as of 2026-10-02), used only when the `coli` command isn't
// installed. With `coli` installed, the live list from `coli setup --list --all --json` is shown instead.
const CATALOG = [
  { id: 'qwen36-35b', name: 'Qwen3.6-35B-A3B', family: 'qwen36', download_gb: 23.1, ram_min_gb: 10, ram_good_gb: 20, dense_gb: 3.5, rank: 3, size: 'small', kind: 'text', summary: 'general chat with thinking and tools; int4-gs64 container' },
  { id: 'qwen3-coder-30b', name: 'Qwen3-Coder-30B-A3B', family: 'qwen36', download_gb: 19.4, ram_min_gb: 8, ram_good_gb: 18, dense_gb: 3.6, rank: 2, size: 'small', kind: 'text', summary: 'coding model with tool calls, no thinking; int4-gs64 container' },
  { id: 'deepseek-v4-flash-reap', name: 'DeepSeek V4 Flash REAP 150B', family: 'deepseek_v4', download_gb: 84.7, ram_min_gb: 16, ram_good_gb: 32, dense_gb: 7.9, rank: 4, size: 'large', kind: 'text', summary: 'pruned DeepSeek V4 Flash (132 of 256 experts), official fp4/fp8 weights' },
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', family: 'deepseek_v4', download_gb: 166.9, ram_min_gb: 16, ram_good_gb: 32, dense_gb: 7.9, rank: 5, size: 'large', kind: 'text', summary: '284B, official checkpoint, no conversion' },
  { id: 'qwen38-flash-next', name: 'Qwen3.8-Flash-Next', family: 'qwen38', download_gb: 185.6, ram_min_gb: 24, ram_good_gb: 32, dense_gb: 8.0, rank: 5, size: 'large', kind: 'text', summary: '125B + 51B n-gram, official FP8 checkpoint', vision: true },
  { id: 'mimo-v2.6-flash', name: 'MiMo-V2.6 Flash', family: 'mimo', download_gb: 171.8, ram_min_gb: 32, ram_good_gb: 52, dense_gb: 24.0, rank: 6, size: 'large', kind: 'text', summary: '309B with vision and tools, official checkpoint', vision: true },
  { id: 'glm-5.2', name: 'GLM-5.2', family: 'glm', download_gb: 429.3, ram_min_gb: 16, ram_good_gb: 24, dense_gb: 9.9, rank: 8, size: 'large', kind: 'text', summary: '744B, the reference model; int4-gs64 with the int8 MTP head' },
  { id: 'glm-5.3', name: 'GLM-5.3', family: 'glm', download_gb: 419.3, ram_min_gb: 16, ram_good_gb: 24, dense_gb: 9.9, rank: 8, size: 'large', kind: 'text', summary: '744B, int4-gs64, no MTP head (no speculative decoding)' },
  { id: 'mimo-v2.6-pro', name: 'MiMo-V2.6 Pro', family: 'mimo', download_gb: 563.6, ram_min_gb: 54, ram_good_gb: 64, dense_gb: 32.4, rank: 9, size: 'large', kind: 'text', summary: '1.02T with vision and tools, official checkpoint', vision: true },
  { id: 'inkling', name: 'Inkling', family: 'inkling', download_gb: 514.1, ram_min_gb: 120, ram_good_gb: 128, dense_gb: 49.4, rank: 9, size: 'large', kind: 'text', summary: '975B, int4 experts with bf16 dense weights (no tool calls)' },
  { id: 'kimi-k3', name: 'Kimi K3', family: 'kimi', download_gb: 1561.0, ram_min_gb: 32, ram_good_gb: 64, dense_gb: 20.0, rank: 10, size: 'large', kind: 'text', summary: '2.8T, original checkpoint with native MXFP4 experts' },
  { id: 'qwen-image-2.1', name: 'Qwen-Image-2.1', family: 'qwen_image', download_gb: 33.1, ram_min_gb: 12, ram_good_gb: 18, dense_gb: 8.5, rank: 1, size: 'small', kind: 'image', summary: 'text to image (pictures, not chat)', license: 'Qwen Research License: non-commercial use only' }
];
const GB = 1e9;

// Colibri's own rule (setup_catalog.assess / recommend), so the copy is marked the way `coli setup` would mark it.
function assess(m, ramTotal, diskFree) {
  const needDisk = m.download_gb * GB * 1.02 + 2 * GB;
  if (ramTotal != null && ramTotal < m.ram_min_gb * GB) return ['needs-ram', 'needs ' + m.ram_min_gb + ' GB of RAM; this PC has ' + (ramTotal / GB).toFixed(1) + ' GB'];
  if (diskFree != null && diskFree < needDisk) return ['needs-disk', 'needs ' + Math.round(needDisk / GB) + ' GB free for the download; ' + Math.round(diskFree / GB) + ' GB free'];
  if (ramTotal != null && ramTotal < m.ram_good_gb * GB) return ['tight', 'runs with a small expert cache (best with ' + m.ram_good_gb + ' GB)'];
  if (m.size === 'small') return ['good', 'the whole model fits in RAM (' + m.ram_good_gb + ' GB)'];
  return ['good', 'dense part ' + m.dense_gb + ' GB stays in RAM, the experts stream from the SSD'];
}
function recommend(list, ramTotal, diskFree) {
  const rows = list.map((m) => { const [status, reason] = assess(m, ramTotal, diskFree); return Object.assign({}, m, { status, reason, fits: status === 'good' || status === 'tight', recommended: false }); });
  const text = rows.filter((r) => r.fits && r.kind === 'text');
  let pick = null;
  for (const want of ['good', 'tight']) {
    const small = text.filter((r) => r.size === 'small' && r.status === want);
    if (small.length) { pick = small.reduce((a, b) => (b.rank > a.rank ? b : a)); break; }
  }
  if (!pick) { const large = text.filter((r) => r.size === 'large'); if (large.length) pick = large.reduce((a, b) => (b.download_gb < a.download_gb ? b : a)); }
  if (pick) pick.recommended = true;
  const fit = rows.filter((r) => r.fits).sort((a, b) => (b.recommended - a.recommended) || ((a.kind !== 'text') - (b.kind !== 'text')) || (a.download_gb - b.download_gb));
  const rest = rows.filter((r) => !r.fits).sort((a, b) => a.download_gb - b.download_gb);
  return fit.concat(rest);
}

// A row from `coli setup --list --all --json` (setup_catalog.as_dict) in the same shape as the copy above.
function fromColi(r) {
  return { id: r.id, name: r.name || r.id, family: r.family || '', download_gb: r.download_gb, ram_min_gb: r.ram_min_gb, ram_good_gb: r.ram_good_gb, dense_gb: r.dense_gb, size: /RAM/.test(r.runs || '') ? 'small' : 'large', kind: r.kind || 'text', summary: r.summary || '', license: r.license_note || '', status: r.status, reason: r.reason, fits: !!r.fits, recommended: !!r.recommended };
}

// ---------- the `coli` command ----------

function findColi(settings, env, regFile) {
  const s = settings || {};
  const e = env || process.env;
  const home = e.HOME || os.homedir();
  const cands = [];
  if (s.colibriCli) cands.push(s.colibriCli);
  const reg = readRegistry(regFile || registryFile(e));
  const hit = reg.engines.find((x) => /colibri/.test(x.id) && x.cli);
  if (hit) cands.push(hit.cli);
  for (const d of String(e.PATH || '').split(':').filter(Boolean)) cands.push(path.join(d, 'coli'));
  cands.push(path.join(home, 'colibri', 'c', 'coli'), path.join(home, 'colibri', 'coli'), '/opt/colibri/c/coli', '/usr/lib/colibri/c/coli');
  for (const c of cands) { try { fs.accessSync(c, fs.constants.X_OK); if (fs.statSync(c).isFile()) return c; } catch (_) {} }
  return null;
}

function runColi(cli, args, onLine, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, args, { stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { COLI_NO_BROWSER: '1' }) });
    let out = '', err = '';
    const t = timeoutMs ? setTimeout(() => { try { child.kill('SIGTERM'); } catch (_) {} }, timeoutMs) : null;
    const feed = (which) => (d) => { const s = d.toString(); if (which === 'out') out += s; else err += s; if (onLine) for (const l of s.split('\n')) if (l.trim()) onLine(l.trim()); };
    child.stdout.on('data', feed('out'));
    child.stderr.on('data', feed('err'));
    child.on('error', (e) => { if (t) clearTimeout(t); reject(e); });
    child.on('close', (code) => { if (t) clearTimeout(t); code === 0 ? resolve(out) : reject(new Error('coli ' + args[0] + ' failed (' + code + '): ' + (err || out).trim().split('\n').slice(-3).join(' ').slice(0, 300))); });
  });
}

// Every model Colibri offers, assessed for this PC, with the recommended one marked. Plus the model it serves now
// and her own grown brains prepared for Colibri.
async function catalog({ settings, env, regFile, run, served, grown, ramTotal, diskFree } = {}) {
  const cli = findColi(settings, env, regFile);
  let rows = null, source = 'copy';
  if (cli) {
    try {
      const out = await (run || runColi)(cli, ['setup', '--list', '--all', '--json'], null, 60000);
      const s = out.indexOf('['), e = out.lastIndexOf(']');
      const j = JSON.parse(out.slice(s, e + 1));
      if (Array.isArray(j) && j.length) { rows = j.map(fromColi); source = 'coli'; }
    } catch (_) { rows = null; }
  }
  if (!rows) {
    let free = diskFree;
    if (free == null) { try { const st = fs.statfsSync(path.join((env || process.env).HOME || os.homedir())); free = st.bavail * st.bsize; } catch (_) { free = null; } }
    rows = recommend(CATALOG, ramTotal == null ? os.totalmem() : ramTotal, free);
  }
  if (served && !rows.some((r) => r.id === served)) rows.unshift({ id: served, name: served, kind: 'text', summary: 'the model Colibri is serving now', status: 'running', fits: true, recommended: false, local: true });
  for (const g of grown || []) rows.unshift({ id: g.dir, name: 'Ithil generation ' + g.gen, kind: 'text', summary: 'her own grown brain, ready for Colibri', status: 'ready', fits: true, recommended: false, local: true, grown: g.gen });
  for (const r of rows) r.running = !!served && (r.id === served || (r.local && r.id === served));
  return { source, cli, rows, ramGB: Math.round((ramTotal == null ? os.totalmem() : ramTotal) / GB) };
}

module.exports = { ColibriBrain, BrainRouter, EngineError, findColibri, readRegistry, registryFile, normUrl, toOpenAI, CATALOG, assess, recommend, fromColi, findColi, runColi, catalog, DEFAULT_COLIBRI };
