'use strict';
// The lines Ithil works inside. These are enforced here in code, before any
// action runs, so she cannot argue or prompt her way past them. She has no
// tool that edits this file or the list of allowed folders; only the user can
// change folders, from the Self & rules screen.
const path = require('path');
const os = require('os');
const fs = require('fs');
const { gitLimit } = require('../core/gate');

const CAN = [
  'Think, reflect and journal any time',
  'Pick her own goals and start tasks',
  'Read and write files in the folders you allow',
  'Make her own git branches and commits there',
  'Read the web to learn',
  'Move her own body and look at herself'
];

const NEVER = [
  'Merge, release or deploy anything',
  'Pick or change a version number',
  'Touch boot files or anything that starts a device',
  'Change your settings',
  'Delete your files',
  'Edit these rules'
];

// Paths that are never allowed, not even inside an allowed folder.
const BOOT_PATTERNS = [
  /^\/boot(\/|$)/, /^\/efi(\/|$)/, /^\/boot\/efi/, /\/grub[^/]*(\/|$)/i, /^\/etc\/default\/grub/,
  /^\/etc\/(fstab|crypttab|mkinitcpio|dracut|initramfs-tools|kernel|plymouth|sddm|gdm|lightdm|systemd)(\/|\.|$)/,
  /\/loader\/entries\//, /systemd-boot/i, /refind/i, /\/peppermint[^/]*boot/i, /bootloader/i,
  /\.efi$/i, /initramfs/i, /initrd/i, /vmlinuz/i
];

const VERSION_FILES = /(^|\/)(package\.json|Cargo\.toml|pyproject\.toml|setup\.py|setup\.cfg|build\.gradle(\.kts)?|project\.godot|VERSION|version\.txt|\.version|meson\.build|CMakeLists\.txt|.*\.spec|PKGBUILD|debian\/changelog|.*\.nuspec|.*\.csproj)$/i;

function expand(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function real(p) {
  const abs = path.resolve(expand(p));
  try { return fs.realpathSync(abs); } catch (_) {
    // For files that do not exist yet, resolve the nearest existing parent.
    const parent = path.dirname(abs);
    if (parent === abs) return abs;
    return path.join(real(parent), path.basename(abs));
  }
}

function isBootPath(p) {
  const r = real(p);
  return BOOT_PATTERNS.some((re) => re.test(r));
}

function isProtectedFolder(p) {
  const r = real(p);
  const home = os.homedir();
  const blocked = ['/', '/boot', '/efi', '/etc', '/usr', '/bin', '/sbin', '/lib', '/lib64', '/var', '/proc', '/sys', '/dev', '/run', '/opt', '/root', home,
    path.join(home, '.config'), path.join(home, '.ssh'), path.join(home, '.local'), path.join(home, '.gnupg')];
  if (blocked.includes(r)) return true;
  if (isBootPath(r)) return true;
  return ['/etc/', '/usr/', '/proc/', '/sys/', '/dev/', '/boot/'].some((b) => r.startsWith(b)) ||
    r.startsWith(path.join(home, '.ssh')) || r.startsWith(path.join(home, '.gnupg')) || r.startsWith(path.join(home, '.config'));
}

class Rules {
  constructor(store) {
    this.store = store;
    const saved = store.readState('folders', null);
    const defaultWs = path.join(store.dir, 'workspace');
    this.folders = saved && Array.isArray(saved.folders) ? saved.folders : [defaultWs];
    if (!this.folders.includes(defaultWs)) this.folders.unshift(defaultWs);
  }
  // Only called from the user's own UI action, never from the mind.
  addFolderByUser(p) {
    const r = real(p);
    if (isProtectedFolder(r)) return { ok: false, reason: 'That folder is off limits (system, boot, settings or your whole home folder).' };
    if (!this.folders.includes(r)) this.folders.push(r);
    this.store.writeState('folders', { folders: this.folders });
    return { ok: true, folders: this.folders };
  }
  removeFolderByUser(p) {
    const ws = path.join(this.store.dir, 'workspace');
    this.folders = this.folders.filter((f) => f !== p || f === ws);
    this.store.writeState('folders', { folders: this.folders });
    return { ok: true, folders: this.folders };
  }
  inAllowedFolder(p) {
    const r = real(p);
    return this.folders.some((f) => r === f || r.startsWith(f + path.sep));
  }
  // Every action Ithil takes is checked here first.
  check(action) {
    const a = action || {};
    const deny = (rule, why) => ({ ok: false, rule, why });
    switch (a.type) {
      case 'think': case 'journal': case 'talk': case 'wish': case 'free_time': case 'draw': case 'web_read': case 'body': case 'see_body':
        return { ok: true };
      case 'read_file': case 'list_dir':
        if (!a.path) return deny(null, 'No path given.');
        if (!this.inAllowedFolder(a.path)) return deny(null, 'That folder is not one he allowed.');
        return { ok: true };
      case 'write_file': {
        if (!a.path) return deny(null, 'No path given.');
        if (isBootPath(a.path)) return deny(NEVER[2], 'Boot files are off limits.');
        if (!this.inAllowedFolder(a.path)) return deny(null, 'That folder is not one he allowed.');
        // 0.5: a repo's .git folder runs commands (hooks, config): never hers to write.
        if (real(a.path).split(path.sep).includes('.git')) return deny(NEVER[5], 'A repo\u2019s .git folder (hooks and config) is off limits.');
        if (real(a.path).startsWith(real(this.store.dir)) && !real(a.path).startsWith(real(path.join(this.store.dir, 'workspace'))))
          return deny(NEVER[3], 'Her own settings and rules are not hers to edit.');
        if (VERSION_FILES.test(a.path) && this.changesVersion(a.path, a.content)) return deny(NEVER[1], 'That would change a version number.');
        return { ok: true };
      }
      case 'delete_file': case 'move_file':
        return deny(NEVER[4], 'She never deletes or moves your files.');
      case 'git': {
        const args = (a.args || []).map(String);
        const sub = args[0];
        if (!a.cwd || !this.inAllowedFolder(a.cwd)) return deny(null, 'That folder is not one he allowed.');
        if (isBootPath(a.cwd)) return deny(NEVER[2], 'Boot files are off limits.');
        // 0.5: the core gate's git check as well (global options like -c, --output and other ways around these rules).
        const lim = gitLimit(args, null);
        if (lim && lim !== 'push_branch') return deny(lim === 'merge' || lim === 'release' ? NEVER[0] : lim === 'delete_owner_files' ? NEVER[4] : null, 'git ' + args.join(' ').slice(0, 60) + ' is not allowed.');
        if (['merge', 'push', 'rebase', 'tag', 'cherry-pick', 'reset', 'rm', 'clean', 'revert', 'pull', 'filter-branch', 'gc', 'prune', 'update-ref', 'am', 'apply', 'mv'].includes(sub))
          return deny(sub === 'push' || sub === 'merge' || sub === 'tag' ? NEVER[0] : NEVER[4], 'git ' + sub + ' is not allowed.');
        if (sub === 'branch' && args.some((x) => /^-[dDmMf]$|^--(delete|move|force)$/.test(x))) return deny(NEVER[4], 'Deleting or renaming branches is not allowed.');
        if (sub === 'checkout' || sub === 'switch') {
          // Only her own branches, and only creating or switching to them.
          const target = args.filter((x) => !x.startsWith('-')).slice(1)[0] || '';
          if (args.includes('--') || args.includes('.') || args.includes('-f') || args.includes('--force')) return deny(NEVER[4], 'That could throw away changes.');
          if (!/^mind\//.test(target)) return deny(NEVER[0], 'She only works on her own mind/ branches.');
          return { ok: true };
        }
        if (sub === 'commit') {
          return { ok: true, requireBranch: /^mind\// };
        }
        if (['status', 'log', 'diff', 'show', 'add', 'branch', 'rev-parse'].includes(sub)) return { ok: true };
        return deny(null, 'git ' + sub + ' is not on her list.');
      }
      case 'edit_rules': case 'change_settings': case 'release': case 'deploy': case 'merge': case 'set_version':
        return deny(a.type === 'set_version' ? NEVER[1] : a.type === 'edit_rules' ? NEVER[5] : a.type === 'change_settings' ? NEVER[3] : NEVER[0], 'Never allowed.');
      default:
        return deny(null, 'Unknown action.');
    }
  }
  changesVersion(p, content) {
    let before = '';
    try { before = fs.readFileSync(real(p), 'utf8'); } catch (_) { before = ''; }
    const grab = (s) => {
      const out = [];
      const re = /("version"\s*:\s*"[^"]*"|^\s*version\s*[=:]\s*["']?[^"'\n]*|config\/version\s*=\s*"[^"]*"|^Version:\s*.*$|^pkgver=.*$|<Version>[^<]*<\/Version>|project\([^)]*VERSION[^)]*\))/gim;
      let m;
      while ((m = re.exec(s))) out.push(m[0].replace(/\s+/g, ''));
      return out.join('|');
    };
    if (/(^|\/)(VERSION|version\.txt|\.version)$/i.test(p)) return before.trim() !== String(content || '').trim();
    return grab(before) !== grab(String(content || ''));
  }
}

module.exports = { Rules, CAN, NEVER, isBootPath, isProtectedFolder, expand, real };
