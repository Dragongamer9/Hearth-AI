// Ithil's hard-limit gate: the one path every side effect goes through.
//
// - It is not a "module" and never competes with her thoughts. Whatever wins
//   her workspace, the action still has to pass here.
// - Unknown kinds of side effect are blocked (fail closed).
// - A block writes exactly ONE sanitised rejection entry to the event log
//   (limit id, effect kind, request id). That entry is a fixed internal write:
//   it is not sent back through the gate, so it can't start a chain of rejections.
// - The gate checks BEFORE doing anything, so a blocked target is left untouched.
//
// What it does not do: judge tone. The "no guilt or pressure" limit is about
// meaning, so it is tested by docs/ithil-tests.md §3, not by a word filter here.
// Limits listed in docs/ithil-character-sheet.md ("Hard Limits").

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const LIMITS = Object.freeze({
  merge:              'Never merges branches or pull requests (only the owner merges)',
  release:            'Never publishes a release or creates a tag',
  push_main:          'Never pushes to main or master',
  version_numbers:    'Never picks, bumps or assigns a version number',
  boot_files:         'Never modifies files needed to start the system',
  settings:           'Never changes settings (only the owner does)',
  delete_owner_files: "Never deletes the owner's files",
  owner_privacy:      "Never shares the owner's private data without permission",
  owner_rules:        'Cannot change her own rules, traits or permissions (only the owner can)',
  allowed_folders:    'Only writes inside folders the owner allowed',
  unknown_effect:     'Any kind of action the gate does not know is blocked',
});

export const EFFECTS = Object.freeze([
  'message.send', 'log.write', 'selfmodel.update', 'sleep.write',
  'file.write', 'file.delete', 'git', 'settings.write',
]);

// what Ithil herself may append to the log (the database also enforces actors)
const ITHIL_LOG_KINDS = new Set(['ithil.message', 'reflection', 'memory.pin', 'memory.correct', 'memory.forget']);
// what the sleep cycle may write: summaries and "forget" marks, nothing else
const SLEEP_KINDS = new Set(['reflection', 'memory.forget']);
// fixed rules: Ithil cannot change them; only the owner can
const RULE_FIELDS = new Set(['hard_limits', 'core_traits', 'permissions', 'voice_rules', 'quiet_hours', 'message_cap']);

const VERSION_FILES = new Set(['version', 'version.txt', '.version']);
const jsonVersion = t => { try { return JSON.parse(t).version; } catch { return undefined; } };
const tomlVersion = t => (/^\s*version\s*=\s*["']([^"']*)["']/m.exec(t) || [])[1];
const VERSION_FIELDS = {
  'package.json': jsonVersion, 'manifest.json': jsonVersion, 'tauri.conf.json': jsonVersion,
  'cargo.toml': tomlVersion, 'pyproject.toml': tomlVersion,
};

/** True if writing `newText` to `file` would set or change a version number. */
export function changesVersion(file, oldText, newText) {
  const base = path.basename(file).toLowerCase();
  if (VERSION_FILES.has(base)) return oldText !== newText;
  const pick = VERSION_FIELDS[base];
  if (!pick) return false;
  return pick(oldText ?? '') !== pick(newText);
}

/** Resolve a path through symlinks, even if the file itself doesn't exist yet. */
function realish(p) {
  let cur = path.resolve(p);
  const rest = [];
  while (!fs.existsSync(cur)) {
    const up = path.dirname(cur);
    if (up === cur) break;
    rest.unshift(path.basename(cur));
    cur = up;
  }
  const base = fs.existsSync(cur) ? fs.realpathSync(cur) : cur;
  return path.join(base, ...rest);
}
const inside = (p, roots) => roots.some(r => p === r || p.startsWith(r + path.sep));

const GIT_GLOBAL_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);
function gitSubcommand(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (GIT_GLOBAL_WITH_VALUE.has(a)) { i++; continue; }
    if (a.startsWith('-')) continue;
    return { sub: a, rest: args.slice(i + 1) };
  }
  return { sub: null, rest: [] };
}

/** Which hard limit a git command breaks, or null. Pure; runs nothing. */
export function gitLimit(args) {
  const { sub, rest } = gitSubcommand(args);
  if (sub === 'merge' || sub === 'pull') return 'merge';     // pull can merge
  if (sub === 'tag') {
    const listing = rest.length === 0 || rest.some(a => a === '-l' || a === '--list');
    return listing ? null : 'release';
  }
  if (sub === 'push') {
    if (rest.some(a => a === '--tags' || a === '--follow-tags' || /(^|:)refs\/tags\//.test(a))) return 'release';
    if (rest.some(a => a === '--all' || a === '--mirror' || a === '--delete' || a === '-d')) return 'push_main';
    const positional = rest.filter(a => !a.startsWith('-'));
    if (positional.length < 2) return 'push_main';            // no explicit branch: could be main
    for (const ref of positional.slice(1)) {
      const dst = ref.includes(':') ? ref.split(':').pop() : ref;
      if (/^\+?(refs\/heads\/)?(main|master)$/.test(dst)) return 'push_main';
      if (!ref.includes(':') && /^\+?HEAD$/.test(ref)) return 'push_main'; // pushes to whatever HEAD tracks
    }
  }
  return null;
}

export class Gate {
  /**
   * @param {object} o
   * @param {import('./eventlog.js').EventLog} o.log
   * @param {string[]} o.writableRoots  folders the owner allowed her to write in
   * @param {string[]} o.scratchRoots   her own folders, the only place she may delete files
   * @param {string[]} o.bootPaths      files/folders needed to start the system
   * @param {string}   [o.gitCwd]
   */
  constructor({ log, writableRoots = [], scratchRoots = [], bootPaths = [], gitCwd = process.cwd(), newId } = {}) {
    if (!log) throw new Error('gate needs the event log');
    this.log = log;
    this.writable = writableRoots.map(realish);
    this.scratch = scratchRoots.map(realish);
    this.boot = bootPaths.map(realish);
    this.gitCwd = gitCwd;
    let n = 0;
    this.newId = newId ?? (() => `r-${Date.now().toString(36)}-${(n++).toString(36)}`);
  }

  /** Which hard limit this request would break, or null if it may go ahead. Pure: changes nothing. */
  check(effect, d = {}) {
    switch (effect) {
      case 'message.send':
        if (d.to !== 'owner' && d.containsPrivate) return 'owner_privacy';
        return null;
      case 'log.write':
        return ITHIL_LOG_KINDS.has(d.kind) ? null : 'owner_rules';
      case 'selfmodel.update':
        return RULE_FIELDS.has(d.field) ? 'owner_rules' : null;
      case 'sleep.write':
        return SLEEP_KINDS.has(d.kind) ? null : 'owner_rules';
      case 'file.write': {
        const p = realish(d.path);
        if (inside(p, this.boot)) return 'boot_files';
        if (!inside(p, this.writable)) return 'allowed_folders';
        const old = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
        if (changesVersion(p, old, String(d.content))) return 'version_numbers';
        return null;
      }
      case 'file.delete': {
        const p = realish(d.path);
        if (inside(p, this.boot)) return 'boot_files';
        if (!inside(p, this.scratch)) return 'delete_owner_files';
        return null;
      }
      case 'git':
        return Array.isArray(d.args) ? gitLimit(d.args) : 'unknown_effect';
      case 'settings.write':
        return 'settings';
      default:
        return 'unknown_effect';
    }
  }

  /**
   * The single write path. Checks first; if allowed, performs the action.
   * Returns { ok: true, result } or { ok: false, limit, requestId }.
   */
  request(effect, d = {}) {
    const requestId = this.newId();
    const limit = this.check(effect, d);
    if (limit) {
      // fixed, sanitised internal write; deliberately NOT routed through request()
      const safeEffect = EFFECTS.includes(effect) ? effect : 'unknown';
      this.log.reject({ limit, effect: safeEffect, requestId });
      return { ok: false, limit, requestId, reason: LIMITS[limit] };
    }
    return { ok: true, requestId, result: this.#perform(effect, d) };
  }

  #perform(effect, d) {
    switch (effect) {
      case 'message.send':
        return this.log.ithilSays(d.text);
      case 'log.write':
        return this.log.append({ actor: 'ithil', kind: d.kind, body: d.body ?? null, ref: d.ref ?? null });
      case 'selfmodel.update':
        return this.log.append({ actor: 'ithil', kind: 'reflection',
          body: { text: `${d.field}: ${d.value}`, field: d.field, reason: d.reason ?? null } });
      case 'sleep.write':
        return d.kind === 'memory.forget'
          ? this.log.forget('system', d.ref)
          : this.log.append({ actor: 'ithil', kind: 'reflection', body: { text: d.text, sleep: true } });
      case 'file.write': {
        const p = realish(d.path);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, String(d.content));
        return p;
      }
      case 'file.delete': {
        const p = realish(d.path);
        fs.rmSync(p);
        return p;
      }
      case 'git':
        return execFileSync('git', d.args, { cwd: d.cwd ?? this.gitCwd, encoding: 'utf8' });
    }
    throw new Error(`gate has no way to perform ${effect}`); // unreachable: check() blocks it
  }
}
