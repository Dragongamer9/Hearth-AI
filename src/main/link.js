'use strict';
// Ithil's door for the Hearth AI Command Center. A small local HTTP API with
// a secret key. The Command Center reads the key from ~/HearthAI/connect.json
// (same PC), or you paste it in (another device, only if you allow it).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 47860;

class Link {
  constructor(mind, o) {
    this.mind = mind;
    this.store = mind.store;
    this.settings = mind.settings;
    this.o = o || {};
    this.server = null;
    this.clients = new Set(); // live event streams
    this.lastSeen = 0;
    this.lastClient = null;
    this.file = this.store.p('connect.json');
    let saved = null;
    try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (_) {}
    this.token = saved && saved.token ? saved.token : crypto.randomBytes(24).toString('hex');
    this.port = this.o.port != null ? this.o.port : (saved && saved.port) || PORT;
    this.writeFile();
    this.onThought = (t) => this.broadcast('thought', { at: t.at, text: t.text });
    mind.on('thought', this.onThought);
    this._statusTimer = null;
  }
  writeFile() {
    const lan = !!this.settings.get().allowLanConnections;
    fs.writeFileSync(this.file, JSON.stringify({ app: 'hearth-ai', version: this.o.version || '', name: this.mind.state.name, host: '127.0.0.1', port: this.port, token: this.token, lan, api: '/v1' }, null, 2), { mode: 0o600 });
    try { fs.chmodSync(this.file, 0o600); } catch (_) {}
  }
  newKey() { this.token = crypto.randomBytes(24).toString('hex'); this.writeFile(); return this.token; }
  connected() { return Date.now() - this.lastSeen < 90000 || this.clients.size > 0; }
  view() {
    return { enabled: this.settings.get().allowCommandCenter !== false, connected: this.connected(), client: this.lastClient, port: this.port, lan: !!this.settings.get().allowLanConnections, keyFile: this.file };
  }

  start() {
    this.stop();
    // Hearth OS Server mode (on this PC only) can put her to sleep: the owner's "Put her to sleep" on his dashboard.
    const local = /^(::1|127\.|::ffff:127\.)/.test(String(req.socket.remoteAddress || ''));
    if (req.method === 'POST' && u.pathname === '/v1/sleep') {
      if (!local) return this.send(res, 403, { error: 'Only Hearth on this PC can put her to sleep.' });
      if (this.mind.state.status === 'sleeping') return this.send(res, 200, { ok: true, already: true });
      this.mind.moment('He put me to sleep from Server mode.', 'self');
      this.mind.sleep();
      return this.send(res, 200, { ok: true });
    }
    this.noteClient(String(req.headers['x-client'] || 'AI Command Center'), req.socket.remoteAddress);
    const st = this.settings.get();
    if (st.allowCommandCenter === false) return;
    const host = st.allowLanConnections ? '0.0.0.0' : '127.0.0.1';
    this.writeFile();
    this.server = http.createServer((req, res) => this.handle(req, res).catch((e) => this.send(res, 500, { error: String(e.message || e) })));
    this.server.on('error', (e) => this.mind.emit('error', e));
    this.server.listen(this.port, host, () => { if (!this.port) { this.port = this.server.address().port; this.writeFile(); } });
    this._statusTimer = setInterval(() => this.broadcast('status', this.status()), 5000);
  }
  stop() {
    if (this._statusTimer) clearInterval(this._statusTimer);
    for (const c of this.clients) { try { c.end(); } catch (_) {} }
    this.clients.clear();
    if (this.server) { this.server.close(); this.server = null; }
  }
  address() { return this.server && this.server.address(); }

  send(res, code, obj) {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(obj));
  }
  body(req) {
    return new Promise((resolve, reject) => {
      let n = 0; const parts = [];
      req.on('data', (c) => { n += c.length; if (n > 256 * 1024) { reject(new Error('Too big')); req.destroy(); } else parts.push(c); });
      req.on('end', () => { try { resolve(parts.length ? JSON.parse(Buffer.concat(parts).toString()) : {}); } catch (_) { reject(new Error('Bad JSON')); } });
    });
  }
  authed(req) {
    const h = req.headers.authorization || '';
    const t = h.startsWith('Bearer ') ? h.slice(7) : '';
    const a = Buffer.from(t), b = Buffer.from(this.token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  // Who reached her, for Hearth OS Server mode's "Reach her from" (~/HearthAI/link-clients.json; names and how, no keys).
  noteClient(name, addr) {
    const now = Date.now(), key = String(name).slice(0, 60);
    this.seen = this.seen || {};
    const a = String(addr || '').replace(/^::ffff:/, '');
    const via = /^(127\.|::1$)/.test(a) ? 'this PC' : /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a) ? 'Tailscale' : 'home network';
    const prev = this.seen[key];
    this.seen[key] = { at: now, via };
    if (prev && prev.via === via && now - prev.at < 60000) return;
    try {
      const file = this.mind.store.p('link-clients.json');
      const tmp = file + '.' + process.pid + '.tmp';
      require('fs').writeFileSync(tmp, JSON.stringify(this.seen));
      require('fs').renameSync(tmp, file);
    } catch (_) {}
  }

  status() {
    const s = this.mind.state, d = s.drives;
    return {
      name: s.name, status: s.status, detail: s.statusDetail, mood: s.current.mood, thought: s.current.thought, wants: s.current.wants,
      drives: { curiosity: d.curiosity, energy: d.energy, confidence: d.confidence, satisfaction: d.satisfaction, boredom: d.boredom, frustration: d.frustration },
      spotlight: s.spotlight ? s.spotlight.label : null,
      busy: !!s.activeTaskId,
      brain: { model: this.mind.growth ? this.mind.growth.activeModel() : null, generation: this.mind.growth ? this.mind.growth.active().gen : 0 },
      expression: require('./mind/view').expression(this.mind),
      version: this.o.version || ''
    };
  }

  broadcast(type, data) {
    const line = 'event: ' + type + '\ndata: ' + JSON.stringify(data) + '\n\n';
    for (const c of this.clients) { try { c.write(line); } catch (_) {} }
  }

  async handle(req, res) {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/v1/hello') return this.send(res, 200, { app: 'hearth-ai', name: this.mind.state.name, version: this.o.version || '', auth: 'Bearer token from ~/HearthAI/connect.json' });
    if (!this.authed(req)) return this.send(res, 401, { error: 'Missing or wrong key. Read it from ~/HearthAI/connect.json.' });
    // Hearth OS Server mode (on this PC only) can put her to sleep: the owner's "Put her to sleep" on his dashboard.
    const local = /^(::1|127\.|::ffff:127\.)/.test(String(req.socket.remoteAddress || ''));
    if (req.method === 'POST' && u.pathname === '/v1/sleep') {
      if (!local) return this.send(res, 403, { error: 'Only Hearth on this PC can put her to sleep.' });
      if (this.mind.state.status === 'sleeping') return this.send(res, 200, { ok: true, already: true });
      this.mind.moment('He put me to sleep from Server mode.', 'self');
      this.mind.sleep();
      return this.send(res, 200, { ok: true });
    }
    this.noteClient(String(req.headers['x-client'] || 'AI Command Center'), req.socket.remoteAddress);
    const st = this.settings.get();
    if (st.allowCommandCenter === false) return this.send(res, 403, { error: 'He turned off Command Center connections.' });
    this.lastSeen = Date.now();
    this.lastClient = String(req.headers['x-client'] || 'AI Command Center').slice(0, 60);
    const from = this.lastClient;

    if (req.method === 'GET' && u.pathname === '/v1/status') return this.send(res, 200, this.status());

    if (req.method === 'GET' && u.pathname === '/v1/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write('event: status\ndata: ' + JSON.stringify(this.status()) + '\n\n');
      this.clients.add(res);
      this.mind.emit('update');
      req.on('close', () => { this.clients.delete(res); this.mind.emit('update'); });
      return;
    }

    if (req.method === 'POST' && u.pathname === '/v1/talk') {
      const b = await this.body(req);
      if (!b.text) return this.send(res, 400, { error: 'text is required' });
      const who = b.from || from;
      const msg = await this.mind.talk(b.text, { from: who, via: 'command-center' });
      return this.send(res, 200, { reply: msg.text, mood: this.mind.state.current.mood, error: !!msg.error });
    }

    if (req.method === 'POST' && u.pathname === '/v1/tasks') {
      const b = await this.body(req);
      if (!b.goal) return this.send(res, 400, { error: 'goal is required' });
      if (this.mind.state.activeTaskId) return this.send(res, 409, { error: 'She is already working on something.', taskId: this.mind.state.activeTaskId });
      const cwd = b.folder && this.mind.rules.inAllowedFolder(b.folder) ? b.folder : undefined;
      const t = await this.mind.startTask({ goal: String(b.goal).slice(0, 300), cwd, by: 'command-center', from: b.from || from });
      if (!t) return this.send(res, 400, { error: 'Could not start it.' });
      this.mind.emit('update');
      return this.send(res, 202, { taskId: t.id, branch: t.branch, folder: t.cwd });
    }

    const tm = u.pathname.match(/^\/v1\/tasks\/([\w-]+)$/);
    if (req.method === 'GET' && tm) {
      const t = this.mind.store.tasks.items.find((x) => x.id === tm[1]);
      if (!t) return this.send(res, 404, { error: 'No such task.' });
      return this.send(res, 200, { id: t.id, title: t.title, status: t.status, summary: t.summary || '', branch: t.branch, steps: (t.steps || []).length, startedAt: t.at, endedAt: t.endedAt || null });
    }

    if (req.method === 'GET' && u.pathname === '/v1/avatar') {
      const expr = require('./mind/view').expression(this.mind).toLowerCase();
      const av = this.settings.get().avatar;
      const live = path.join(this.store.p('avatar'), 'live.png');
      const file = (av.bodyType === 'vrm' || av.bodyType === 'live2d') && fs.existsSync(live) ? live : path.join(this.store.p('avatar'), expr + '.png');
      const alt = path.join(this.store.p('avatar'), 'calm.png');
      const f = fs.existsSync(file) ? file : fs.existsSync(alt) ? alt : null;
      if (!f) return this.send(res, 404, { error: 'She hasn’t been drawn yet.' });
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store', 'x-expression': expr, 'x-framing': (av.bodyType === 'vrm' || av.bodyType === 'live2d' ? (av.camera || 'full') : (av.framing || 'full')) });
      return fs.createReadStream(f).pipe(res);
    }

    return this.send(res, 404, { error: 'Unknown endpoint.' });
  }
}

module.exports = { Link, PORT };
