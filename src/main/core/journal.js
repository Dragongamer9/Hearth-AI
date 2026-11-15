'use strict';
// 0.5: the app's link to Ithil's event log (core/eventlog.js), kept at ~/HearthAI/events.db.
//
// Everything said, every memory she keeps, every change he makes to one and every action the
// rules block is appended here. The log is append-only: only his "Forget" in the Memory screen
// wipes a memory's words (an owner purge).
//
// It never stops her from starting: if the log can't open (no SQLite in this Electron, a broken
// file), she runs exactly as in 0.4, `ok` is false and `why` says what happened. A file that
// fails to open is moved aside (kept, never overwritten) and a fresh log is started.
const fs = require('fs');
const path = require('path');

class Journal {
  constructor(dir) {
    this.file = path.join(dir, 'events.db');
    this.log = null;
    this.ok = false;
    this.why = '';
    this.pins = new Map();   // app memory id -> pin event id (rebuilt from the log)
    try {
      this.open();
    } catch (e) {
      this.why = String((e && e.message) || e).slice(0, 300);
      // Only a damaged file is moved aside (a missing SQLite or a locked file is left alone).
      if (fs.existsSync(this.file) && /not a database|malformed|corrupt/i.test(this.why)) {
        try {
          const aside = this.file + '.unreadable-' + Date.now();
          fs.renameSync(this.file, aside);
          this.open();
          this.why = 'The old event log could not be read; it was kept as ' + path.basename(aside) + ' and a new one started.';
        } catch (e2) { this.log = null; this.ok = false; this.why = String((e2 && e2.message) || e2).slice(0, 300); }
      }
    }
  }
  open() {
    const { EventLog } = require('./eventlog');   // needs node:sqlite (Node 22.13+)
    this.log = new EventLog(this.file);
    this.ok = true;
    for (const e of this.log.all()) if (e.kind === 'memory.pin' && e.body && typeof e.body.key === 'string' && e.body.key.startsWith('mem:')) this.pins.set(e.body.key.slice(4), e.id);
  }
  safe(fn) {
    if (!this.ok) return null;
    try { return fn(this.log); } catch (e) { this.why = String((e && e.message) || e).slice(0, 300); return null; }
  }
  // ---- what happened -------------------------------------------------------
  ownerSaid(text, from) {
    // A teammate from his AI Command Center isn't him: kept as an input, not as his words.
    return this.safe((l) => (from ? l.input({ from: String(from).slice(0, 60), text: String(text).slice(0, 4000) }) : l.ownerSays(String(text).slice(0, 4000))));
  }
  ithilSaid(text) { return this.safe((l) => l.ithilSays(String(text).slice(0, 4000))); }
  // A memory she (or the app, for her) kept.
  memoryKept(m, by) {
    return this.safe((l) => {
      const id = l.pin(by === 'owner' ? 'owner' : 'ithil', 'mem:' + m.id, String(m.text || ''));
      this.pins.set(m.id, id);
      return id;
    });
  }
  // He changed a memory's words in the Memory screen.
  memoryEditedByOwner(memId, text) {
    const pin = this.pins.get(memId);
    return pin ? this.safe((l) => l.correct('owner', pin, String(text), 'changed by him')) : null;
  }
  // He made her forget a memory: its words are wiped from the log too.
  memoryForgottenByOwner(memId) {
    const pin = this.pins.get(memId);
    if (!pin) return null;
    return this.safe((l) => { const ids = l.purge(pin); this.pins.delete(memId); return ids; });
  }
  // 0.6: his Memory screen, by event id (Mark deleted / Restore / Erase…).
  markDeletedByOwner(pinId) { return this.safe((l) => l.markDeleted(pinId)); }
  restoreByOwner(pinId) { return this.safe((l) => l.restore(pinId)); }
  eraseByOwner(pinId) {
    return this.safe((l) => { const ids = l.purge(pinId); for (const [k, v] of this.pins) if (v === pinId) this.pins.delete(k); return ids; });
  }
  memIdOf(pinId) { for (const [k, v] of this.pins) if (v === pinId) return k; return null; }
  // An action the rules blocked: fixed tokens only, never the content.
  blocked(rule, type) {
    const tok = (s, d) => (String(s || d).toLowerCase().replace(/[^a-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64) || d);
    return this.safe((l) => l.reject({ limit: tok(rule, 'rule'), effect: tok(type, 'action'), requestId: 'r-' + Date.now().toString(36) }));
  }
  // 0.6: an action the rules allowed (file writes, pushes), counted on the Gate screen.
  allowed(what) { return this.safe((l) => l.input({ allowed: String(what).slice(0, 40) })); }
  status() {
    if (!this.ok) return { ok: false, why: this.why };
    return this.safe((l) => ({ ok: true, events: l.db.prepare('SELECT COUNT(*) AS n FROM events').get().n, file: this.file, note: this.why || '' })) || { ok: false, why: this.why };
  }
  close() { if (this.log) try { this.log.close(); } catch (_) {} this.log = null; this.ok = false; }
}

module.exports = { Journal };
