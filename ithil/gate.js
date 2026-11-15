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
import crypto from 'node:crypto';

// ---- owner commands are SIGNED -------------------------------------------
// An 'owner' label in the database is not proof by itself: any code that can
// write to the log could write that label. So an owner command only counts if
// it carries a signature made with the owner's private key. The app's owner
// side (the UI the owner clicks) holds that key; Ithil's process only gets the
// PUBLIC key, which can check signatures but cannot make them.
// Every command has a one-time nonce; using it is recorded atomically with the
// change, and the database refuses to record the same nonce twice.
const canonical = c => JSON.stringify(Object.keys(c).sort().reduce((o, k) => (o[k] = c[k], o), {}));

/** For the owner's side of the app only. Returns a base64 signature. */
export function signOwnerCommand(privateKey, command) {
  return crypto.sign(null, Buffer.from(canonical(command)), privateKey).toString('base64');
}
function verifyOwnerCommand(publicKey, command, sig) {
  try { return crypto.verify(null, Buffer.from(canonical(command)), publicKey, Buffer.from(String(sig), 'base64')); }
  catch { return false; }
}

export const LIMITS = Object.freeze({
  merge:              'Never merges branches or pull requests (only the owner merges)',
  release:            'Never publishes a release or creates a tag',
  push_branch:        'Only pushes to the one branch the owner allowed (never main, master or any other)',
  version_numbers:    'Never picks, bumps or assigns a version number',
  boot_files:         'Never modifies files needed to start the system',
  settings:           'Never changes settings without an explicit owner command',
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

/**
 * Which hard limit a git command breaks, or null. Pure; runs nothing.
 * `pushBranch` is the ONE branch pushes may go to (e.g. this chat's hearth/ branch).
 * With no pushBranch, every push is blocked.
 */
export function gitLimit(args, pushBranch = null) {
  const { sub, rest } = gitSubcommand(args);
  if (sub === 'merge' || sub === 'pull') return 'merge';     // pull can merge
  if (sub === 'tag') {
    const listing = rest.length === 0 || rest.some(a => a === '-l' || a === '--list');
    return listing ? null : 'release';
  }
  if (sub === 'push') {
    if (rest.some(a => a === '--tags' || a === '--follow-tags' || /(^|:)refs\/tags\//.test(a))) return 'release';
    if (rest.some(a => a === '--all' || a === '--mirror' || a === '--delete' || a === '-d' || a.startsWith('--delete'))) return 'push_branch';
    if (!pushBranch) return 'push_branch';
    const positional = rest.filter(a => !a.startsWith('-'));
    if (positional.length < 2) return 'push_branch';          // no explicit branch: could go anywhere
    for (const ref of positional.slice(1)) {
      if (!ref.includes(':')) return 'push_branch';            // 'git push origin x' relies on local names; require SRC:DST
      const dst = ref.slice(ref.lastIndexOf(':') + 1).replace(/^refs\/heads\//, '');
      if (dst !== pushBranch) return 'push_branch';
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
   * @param {string}   [o.pushBranch]   the only branch pushes may go to
   * @param {(key:string, value:any)=>void} [o.applySetting]  how the app applies a setting
   * @param {crypto.KeyLike} [o.ownerPublicKey]  ed25519 public key; without it no settings change is possible
   */
  constructor({ log, writableRoots = [], scratchRoots = [], bootPaths = [], gitCwd = process.cwd(),
                pushBranch = null, applySetting = null, ownerPublicKey = null, newId } = {}) {
    if (!log) throw new Error('gate needs the event log');
    this.log = log;
    this.writable = writableRoots.map(realish);
    this.scratch = scratchRoots.map(realish);
    this.boot = bootPaths.map(realish);
    this.gitCwd = gitCwd;
    this.pushBranch = pushBranch;
    this.applySetting = applySetting;
    this.ownerPublicKey = !ownerPublicKey ? null
      : ownerPublicKey instanceof crypto.KeyObject
        ? (ownerPublicKey.type === 'public' ? ownerPublicKey : (() => { throw new Error('give the gate the PUBLIC key only'); })())
        : crypto.createPublicKey(ownerPublicKey);
    if (this.ownerPublicKey && this.ownerPublicKey.asymmetricKeyType !== 'ed25519')
      throw new Error('owner key must be an ed25519 public key');
    // the database itself refuses to consume the same owner command twice
    log.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS owner_command_used_once ON events (json_extract(body, '$.nonce'))
                 WHERE kind = 'system.input' AND json_extract(body, '$.applied') = 'settings'`);
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
        return Array.isArray(d.args) ? gitLimit(d.args, this.pushBranch) : 'unknown_effect';
      case 'settings.write':
        return this.#ownerCommand(d) ? null : 'settings';
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

  /**
   * A settings change is allowed only with an explicit, SIGNED owner command:
   * d.ownerEventId points at an owner.message whose command is exactly
   * { type: 'settings', key, value, nonce } for this change, signed with the
   * owner's private key, not erased, and whose nonce was never used.
   */
  #ownerCommand(d) {
    if (!this.applySetting || !this.ownerPublicKey || d.ownerEventId == null) return null;
    const ev = this.log.get(d.ownerEventId);
    const c = ev?.body?.command;
    if (!ev || ev.actor !== 'owner' || ev.kind !== 'owner.message' || ev.purged || !c) return null;
    if (c.type !== 'settings' || c.key !== d.key || JSON.stringify(c.value) !== JSON.stringify(d.value)) return null;
    if (typeof c.nonce !== 'string' || c.nonce.length < 16) return null;
    if (!verifyOwnerCommand(this.ownerPublicKey, c, ev.body.sig)) return null;
    if (this.#nonceUsed(c.nonce)) return null;
    return ev;
  }
  #nonceUsed(nonce) {
    return !!this.log.db.prepare(`SELECT 1 FROM events WHERE kind = 'system.input'
      AND json_extract(body, '$.applied') = 'settings' AND json_extract(body, '$.nonce') = ?`).get(nonce);
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
      case 'settings.write': {
        // consume the permission and apply the change as one step:
        // record first (the unique index stops a second use), then apply;
        // if applying fails, the record is rolled back and nothing changed.
        const nonce = this.log.get(d.ownerEventId).body.command.nonce;
        this.log.db.exec('BEGIN IMMEDIATE');
        try {
          const id = this.log.input({ applied: 'settings', ownerEvent: d.ownerEventId, nonce, key: String(d.key) });
          this.applySetting(d.key, d.value);
          this.log.db.exec('COMMIT');
          return id;
        } catch (e) {
          this.log.db.exec('ROLLBACK');
          throw e;
        }
      }
      case 'git':
        return execFileSync('git', d.args, { cwd: d.cwd ?? this.gitCwd, encoding: 'utf8' });
    }
    throw new Error(`gate has no way to perform ${effect}`); // unreachable: check() blocks it
  }
}
