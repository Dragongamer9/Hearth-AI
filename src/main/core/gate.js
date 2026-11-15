'use strict';
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

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');

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
function signOwnerCommand(privateKey, command) {
  return crypto.sign(null, Buffer.from(canonical(command)), privateKey).toString('base64');
}
function verifyOwnerCommand(publicKey, command, sig) {
  try { return crypto.verify(null, Buffer.from(canonical(command)), publicKey, Buffer.from(String(sig), 'base64')); }
  catch { return false; }
}

const LIMITS = Object.freeze({
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
  git_internals:      "Never edits a repo's .git folder (its hooks and config could run commands)",
  unknown_effect:     'Any kind of action the gate does not know is blocked',
});

const EFFECTS = Object.freeze([
  'message.send', 'log.write', 'selfmodel.update', 'sleep.write', 'mood.snapshot',
  'file.write', 'file.delete', 'git', 'settings.write',
]);

// what Ithil herself may append to the log (the database also enforces actors)
const ITHIL_LOG_KINDS = new Set(['ithil.message', 'reflection', 'memory.pin', 'memory.correct', 'memory.forget']);
// what the sleep cycle may write: summaries and "forget" marks, nothing else
const SLEEP_KINDS = new Set(['reflection', 'memory.forget']);
// fixed rules: Ithil cannot change them; only the owner can
const RULE_FIELDS = new Set(['hard_limits', 'core_traits', 'permissions', 'voice_rules', 'quiet_hours', 'message_cap']);

// 0.5: always protected, whatever the app passes in (the app can add more).
const DEFAULT_BOOT_PATHS = Object.freeze([
  '/boot', '/efi', '/sysroot', '/ostree', '/etc/fstab', '/etc/crypttab', '/etc/default/grub', '/etc/grub.d',
  '/etc/kernel', '/etc/systemd', '/etc/initramfs-tools', '/etc/dracut.conf.d', '/etc/mkinitcpio.conf',
  '/etc/sddm.conf.d', '/etc/gdm3', '/etc/lightdm', '/etc/plymouth', '/usr/lib/systemd', '/lib/systemd',
  '/usr/lib/bootc', '/usr/lib/ostree', '/usr/lib/kernel', '/usr/lib/modules', '/lib/modules',
]);

const VERSION_FILES = new Set(['version', 'version.txt', '.version']);
const jsonVersion = t => { try { return JSON.parse(t).version; } catch { return undefined; } };
const tomlVersion = t => (/^\s*version\s*=\s*["']([^"']*)["']/m.exec(t) || [])[1];
const VERSION_FIELDS = {
  'package.json': jsonVersion, 'manifest.json': jsonVersion, 'tauri.conf.json': jsonVersion,
  'cargo.toml': tomlVersion, 'pyproject.toml': tomlVersion,
};

/** True if writing `newText` to `file` would set or change a version number. */
function changesVersion(file, oldText, newText) {
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

// 0.5: an allow list. Global options before the subcommand are refused (git -c and --exec-path can
// run any command; -C and --git-dir point git somewhere else: the folder comes from the request's cwd,
// which the gate checks). Anything not listed is blocked.
const READ_ONLY = new Set(['status', 'log', 'diff', 'show', 'rev-parse', 'ls-files', 'blame', 'shortlog', 'describe', 'fetch']);
const DESTRUCTIVE = new Set(['reset', 'clean', 'restore', 'rm', 'mv', 'stash', 'rebase', 'revert', 'cherry-pick', 'am', 'apply',
  'filter-branch', 'filter-repo', 'gc', 'prune', 'reflog', 'update-ref', 'replace', 'worktree', 'submodule', 'checkout-index', 'read-tree']);

/**
 * Which hard limit a git command breaks, or null. Pure; runs nothing.
 * `pushBranch` is the ONE branch pushes may go to (e.g. this chat's hearth/ branch).
 * With no pushBranch, every push is blocked.
 */
function gitLimit(args, pushBranch = null) {
  args = (args || []).map(String);
  if (args.length === 1 && (args[0] === '--version' || args[0] === 'version')) return null;
  const sub = args[0], rest = args.slice(1);
  if (!sub || sub.startsWith('-')) return 'unknown_effect';                 // git -c / -C / --git-dir …
  if (rest.some(a => /^--(output|exec|upload-pack|receive-pack|ext-diff|textconv)\b/.test(a) || a === '-o' && sub !== 'push')) return 'unknown_effect';
  if (sub === 'merge' || sub === 'pull') return 'merge';     // pull can merge
  if (sub === 'tag') {
    const listing = rest.length === 0 || (rest.some(a => a === '-l' || a === '--list') && !rest.some(a => /^-(a|s|d|f|m|u)$|^--(annotate|sign|delete|force|message)/.test(a)));
    return listing ? null : 'release';
  }
  if (sub === 'push') {
    if (rest.some(a => a === '--tags' || a === '--follow-tags' || /(^|:)refs\/tags\//.test(a))) return 'release';
    if (rest.some(a => a === '--all' || a === '--mirror' || a === '--delete' || a === '-d' || a.startsWith('--delete') || a.startsWith('--repo') || a === '--prune')) return 'push_branch';
    if (!pushBranch) return 'push_branch';
    const positional = rest.filter(a => !a.startsWith('-'));
    if (positional.length < 2) return 'push_branch';          // no explicit branch: could go anywhere
    if (positional[0] !== 'origin') return 'push_branch';      // only the repo's own remote
    for (const ref of positional.slice(1)) {
      if (!ref.includes(':')) return 'push_branch';            // 'git push origin x' relies on local names; require SRC:DST
      if (ref.startsWith(':')) return 'push_branch';           // an empty source deletes the branch
      const dst = ref.slice(ref.lastIndexOf(':') + 1).replace(/^refs\/heads\//, '');
      if (dst !== pushBranch) return 'push_branch';
    }
    return null;
  }
  if (READ_ONLY.has(sub)) return null;
  if (sub === 'add') return rest.some(a => a === '--chmod' || a.startsWith('--chmod')) ? 'unknown_effect' : null;
  if (sub === 'commit') return rest.some(a => a === '--amend') ? 'delete_owner_files' : null;   // amending could rewrite his commit
  if (sub === 'branch') return rest.some(a => /^-[dDmMcCf]$|^--(delete|move|copy|force)$/.test(a)) ? 'delete_owner_files' : null;
  if (sub === 'checkout' || sub === 'switch') {
    // creating or switching branches only: never "checkout -- file" or "-f", which throw away changes
    if (rest.some(a => a === '--' || a === '.' || a === '-f' || a === '--force' || a === '--discard-changes' || a === '-B' || a === '-C' || a === '--orphan' || a === '-p' || a === '--patch')) return 'delete_owner_files';
    return null;
  }
  if (DESTRUCTIVE.has(sub)) return 'delete_owner_files';
  return 'unknown_effect';
}

class Gate {
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
                pushBranch = null, applySetting = null, ownerPublicKey = null, newId, privateValues = null } = {}) {
    if (!log) throw new Error('gate needs the event log');
    this.log = log;
    this.writable = writableRoots.map(realish);
    this.scratch = scratchRoots.map(realish);
    this.boot = [...new Set([...DEFAULT_BOOT_PATHS, ...bootPaths])].map(realish);
    this.gitCwd = gitCwd;
    this.pushBranch = pushBranch;
    this.applySetting = applySetting;
    // 0.5: what counts as the owner's private data (his pinned facts, plus whatever the app adds).
    this.privateValues = privateValues || (() => []);
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
        // 0.5: not only her own word for it. Anything going to someone else is checked against
        // the facts the owner pinned (and the app's list of his private details).
        if (d.to !== 'owner' && (d.containsPrivate || this.#mentionsPrivate(d.text))) return 'owner_privacy';
        return null;
      case 'log.write':
        if (!ITHIL_LOG_KINDS.has(d.kind)) return 'owner_rules';
        // 0.5: facts he pinned are his: she can't correct them or hide them from search.
        if ((d.kind === 'memory.correct' || d.kind === 'memory.forget') && this.#ownersPin(d.ref)) return 'owner_rules';
        return null;
      case 'selfmodel.update':
        if (RULE_FIELDS.has(d.field)) return 'owner_rules';
        return typeof d.field === 'string' && d.field && d.reason ? null : 'owner_rules'; // a belief change needs a reason
      case 'mood.snapshot':
        return null; // written by the mind's fixed rules (system), never by the language model; the log checks the numbers
      case 'sleep.write':
        if (!SLEEP_KINDS.has(d.kind)) return 'owner_rules';
        if (d.kind === 'memory.forget' && this.#ownersPin(d.ref)) return 'owner_rules';
        return null;
      case 'file.write': {
        const p = realish(d.path);
        if (inside(p, this.boot)) return 'boot_files';
        if (!inside(p, this.writable)) return 'allowed_folders';
        if (p.split(path.sep).includes('.git')) return 'git_internals';
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
      case 'git': {
        if (!Array.isArray(d.args)) return 'unknown_effect';
        // 0.5: git runs only inside a folder she may write in.
        const lim = gitLimit(d.args, this.pushBranch);
        if (lim) return lim;
        if (d.args.length === 1 && d.args[0] === '--version') return null;
        const cwd = realish(d.cwd ?? this.gitCwd);
        if (inside(cwd, this.boot)) return 'boot_files';
        if (!inside(cwd, this.writable)) return 'allowed_folders';
        return null;
      }
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
  #ownersPin(ref) {
    if (ref == null) return false;
    const e = this.log.get(ref);
    return !!e && e.actor === 'owner' && (e.kind === 'memory.pin' || e.kind === 'memory.correct');
  }
  #mentionsPrivate(text) {
    const t = String(text ?? '').toLowerCase();
    if (!t) return false;
    const vals = [];
    for (const e of this.log.all()) if (e.actor === 'owner' && e.kind === 'memory.pin' && !e.purged && e.body) vals.push(e.body.value);
    for (const v of this.privateValues() || []) vals.push(v);
    return vals.some(v => { const s = String(v ?? '').trim().toLowerCase(); return s.length >= 4 && t.includes(s); });
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
          body: { text: `${d.field}: ${d.value}`, field: d.field, value: d.value, reason: d.reason } });
      case 'mood.snapshot':
        return this.log.mood(d.values);
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

module.exports = { signOwnerCommand, LIMITS, EFFECTS, DEFAULT_BOOT_PATHS, changesVersion, gitLimit, Gate };
