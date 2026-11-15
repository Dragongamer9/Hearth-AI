'use strict';
// What Ithil can actually do. Every call goes through the rules first.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { real, NEVER } = require('./rules');

// 0.6: which hard limit a block falls under (the gate's codes, shown on the Gate screen).
function limitCode(verdict, a) {
  if (verdict.code) return verdict.code;
  const args = (a.args || []).map(String);
  switch (verdict.rule) {
    case NEVER[0]: return args[0] === 'push' ? 'push_branch' : args[0] === 'tag' ? 'release' : 'merge';
    case NEVER[1]: return 'version_numbers';
    case NEVER[2]: return 'boot_files';
    case NEVER[3]: return 'settings';
    case NEVER[4]: return 'delete_owner_files';
    case NEVER[5]: return 'owner_rules';
    default: return /folder/i.test(verdict.why || '') ? 'allowed_folders' : 'unknown_effect';
  }
}

function git(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 60000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: String(stdout || '').slice(0, 6000), err: String(stderr || (err && err.message) || '').slice(0, 2000) }));
  });
}

function stripHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

class Tools {
  constructor(rules, store, comfy, journal) {
    this.rules = rules;
    this.store = store;
    this.comfy = comfy;
    this.journal = journal || null;   // 0.5: blocked actions are written to the event log
  }
  resolvePath(p, cwd) {
    if (!p) return p;
    if (path.isAbsolute(p) || p.startsWith('~')) return p;
    return path.join(cwd || path.join(this.store.dir, 'workspace'), p);
  }
  // Returns { ok, result } or { ok:false, blocked:true, rule, why }
  async run(action, cwd) {
    const a = Object.assign({}, action);
    if (a.path) a.path = this.resolvePath(a.path, cwd);
    if (a.type === 'git') a.cwd = this.resolvePath(a.cwd || cwd || '.', cwd);
    const verdict = this.rules.check(a);
    if (!verdict.ok) {
      const code = limitCode(verdict, a);
      const effect = a.type === 'write_file' ? 'file.write' : a.type === 'delete_file' ? 'file.delete' : a.type;
      const ev = this.journal ? this.journal.blocked(code, effect) : null;
      const request = ev && this.journal.log ? (this.journal.log.get(ev) || { body: {} }).body.requestId : '';
      if (this.onBlocked) try { this.onBlocked({ code, effect, request }); } catch (_) {}
      return { ok: false, blocked: true, rule: verdict.rule, why: verdict.why, code };
    }
    try {
      switch (a.type) {
        case 'read_file': {
          const data = fs.readFileSync(real(a.path), 'utf8');
          return { ok: true, result: data.slice(0, 12000) };
        }
        case 'list_dir': {
          const list = fs.readdirSync(real(a.path), { withFileTypes: true }).slice(0, 200).map((e) => (e.isDirectory() ? e.name + '/' : e.name));
          return { ok: true, result: list.join('\n') };
        }
        case 'write_file': {
          fs.mkdirSync(path.dirname(real(a.path)), { recursive: true });
          fs.writeFileSync(real(a.path), String(a.content == null ? '' : a.content));
          if (this.journal) this.journal.allowed('file.write');
          return { ok: true, result: 'Wrote ' + a.path };
        }
        case 'git': {
          if (verdict.requireBranch) {
            const b = await git(a.cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
            if (!verdict.requireBranch.test(b.out.trim())) return { ok: false, blocked: true, rule: 'Merge, release or deploy anything', why: 'She only commits on her own mind/ branches.' };
          }
          const r = await git(a.cwd, a.args);
          if (r.ok && this.journal && String(a.args[0]) === 'push') this.journal.allowed('git.push');
          return { ok: r.ok, result: r.out || r.err };
        }
        case 'web_read': {
          if (!/^https?:\/\//.test(a.url || '')) return { ok: false, result: 'Not a web address.' };
          const ctl = new AbortController();
          const t = setTimeout(() => ctl.abort(), 20000);
          const r = await fetch(a.url, { signal: ctl.signal, headers: { 'user-agent': 'HearthAI/0.1 (Ithil)' } });
          clearTimeout(t);
          const text = stripHtml(await r.text());
          return { ok: r.ok, result: text.slice(0, 8000) };
        }
        case 'draw': {
          if (!this.comfy) return { ok: false, result: 'No ComfyUI.' };
          const file = await this.comfy.draw(a.prompt, a.file || 'made-' + Date.now() + '.png', a.dir);
          return { ok: !!file, result: file || 'Drawing failed.' };
        }
        default:
          return { ok: true, result: '' };
      }
    } catch (e) {
      return { ok: false, result: String(e.message || e) };
    }
  }
}

module.exports = { Tools, stripHtml, git };
