// Ithil's event log: the one record everything else is rebuilt from.
//
// Rules this file enforces (see docs/ithil-mind-architecture.md):
// - Append-only. Rows are never deleted. The only change ever allowed to an
//   existing row is an owner purge: its body is wiped (set to NULL) and it is
//   flagged purged, and only after an owner.purge event pointing at it exists.
// - Corrections, deletions, restores and "forget" marks are NEW events that
//   point back at the old one. History is never rewritten.
// - Who may write what is checked in SQL, not only in this file:
//   owner-only kinds, system-only kinds (moods, gate rejections), Ithil-only kinds.
// - Rejection entries are fixed and sanitised: no free text, nothing private.
//
// Limits (honest): anyone with direct access to the database file can drop the
// triggers. These checks protect against Ithil's own code paths, not against
// someone editing the file by hand. Erased text may also linger in the
// filesystem's free space; use disk encryption if that matters.
//
// Needs Node 22.13+ (built-in node:sqlite). No other dependencies.

import { DatabaseSync } from 'node:sqlite';

export const KINDS = Object.freeze([
  'owner.message',   // owner said something            (owner)
  'ithil.message',   // Ithil said something            (ithil)
  'system.input',    // time, machine state, etc.       (system)
  'memory.pin',      // a pinned fact {key, value}      (owner | ithil)
  'memory.correct',  // new value for a pinned fact     (owner | ithil), ref -> pin
  'memory.delete',   // mark a fact deleted (hidden)    (owner), ref -> pin
  'owner.restore',   // undo a delete mark              (owner), ref -> pin
  'owner.purge',     // erase an event's content        (owner), ref -> any
  'memory.forget',   // leave out of search, not erased (ithil | system), ref -> any
  'mood.snapshot',   // needs/mood numbers              (system)
  'reflection',      // Ithil's own note about herself  (ithil)
  'gate.reject',     // hard-limit gate blocked a thing (system), sanitised
]);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      TEXT    NOT NULL,
  actor   TEXT    NOT NULL CHECK (actor IN ('owner','ithil','system')),
  kind    TEXT    NOT NULL CHECK (kind IN (${KINDS.map(k => `'${k}'`).join(',')})),
  body    TEXT,
  ref_id  INTEGER REFERENCES events(id),
  purged  INTEGER NOT NULL DEFAULT 0 CHECK (purged IN (0,1)),
  CHECK (kind NOT IN ('owner.message','memory.delete','owner.restore','owner.purge') OR actor = 'owner'),
  CHECK (kind NOT IN ('mood.snapshot','gate.reject','system.input') OR actor = 'system'),
  CHECK (kind NOT IN ('ithil.message','reflection') OR actor = 'ithil'),
  CHECK (kind NOT IN ('memory.pin','memory.correct') OR actor IN ('owner','ithil')),
  CHECK (kind <> 'memory.forget' OR actor IN ('ithil','system')),
  CHECK (kind NOT IN ('memory.correct','memory.delete','owner.restore','owner.purge','memory.forget') OR ref_id IS NOT NULL),
  CHECK (kind <> 'owner.purge' OR body IS NULL)
);

CREATE TRIGGER IF NOT EXISTS events_no_delete
BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'event log is append-only: rows are never deleted'); END;

CREATE TRIGGER IF NOT EXISTS events_only_owner_purge
BEFORE UPDATE ON events
WHEN NOT (
  OLD.purged = 0 AND NEW.purged = 1 AND NEW.body IS NULL
  AND NEW.id = OLD.id AND NEW.ts = OLD.ts AND NEW.actor = OLD.actor
  AND NEW.kind = OLD.kind AND NEW.ref_id IS OLD.ref_id
  AND EXISTS (SELECT 1 FROM events p
              WHERE p.kind = 'owner.purge' AND p.actor = 'owner' AND p.ref_id = OLD.id)
)
BEGIN SELECT RAISE(ABORT, 'event log is append-only: only an owner purge may wipe a row'); END;

CREATE TRIGGER IF NOT EXISTS events_insert_rules
BEFORE INSERT ON events
BEGIN
  SELECT RAISE(ABORT, 'new events cannot start out purged') WHERE NEW.purged <> 0;
  SELECT RAISE(ABORT, 'ref_id must point at an existing event')
    WHERE NEW.ref_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM events WHERE id = NEW.ref_id);
  SELECT RAISE(ABORT, 'this kind must point at a pinned fact')
    WHERE NEW.kind IN ('memory.correct','memory.delete','owner.restore')
      AND NOT EXISTS (SELECT 1 FROM events WHERE id = NEW.ref_id AND kind = 'memory.pin');
  SELECT RAISE(ABORT, 'a purge record cannot itself be purged')
    WHERE NEW.kind = 'owner.purge'
      AND EXISTS (SELECT 1 FROM events WHERE id = NEW.ref_id AND kind = 'owner.purge');
END;
`;

const MOOD_KEYS = ['energy', 'social', 'curiosity', 'stability'];
const SAFE_TOKEN = /^[a-z0-9_.-]{1,64}$/;

export class EventLog {
  constructor(path = ':memory:', { now = () => new Date().toISOString() } = {}) {
    this.db = new DatabaseSync(path);
    this.now = now;
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON;');
    this.db.exec(SCHEMA);
    this._insert = this.db.prepare(
      'INSERT INTO events (ts, actor, kind, body, ref_id) VALUES (?, ?, ?, ?, ?)');
  }

  /** Low-level append. Returns the new event id. */
  append({ actor, kind, body = null, ref = null }) {
    const text = body === null || body === undefined ? null : JSON.stringify(body);
    const r = this._insert.run(this.now(), actor, kind, text, ref);
    return Number(r.lastInsertRowid);
  }

  get(id) {
    const row = this.db.prepare('SELECT * FROM events WHERE id = ?').get(id);
    return row ? toEvent(row) : null;
  }

  all() {
    return this.db.prepare('SELECT * FROM events ORDER BY id').all().map(toEvent);
  }

  // ---- convenience writers -------------------------------------------------
  ownerSays(text)            { return this.append({ actor: 'owner', kind: 'owner.message', body: { text } }); }
  ithilSays(text)            { return this.append({ actor: 'ithil', kind: 'ithil.message', body: { text } }); }
  input(data)                { return this.append({ actor: 'system', kind: 'system.input', body: data }); }
  pin(actor, key, value)     { return this.append({ actor, kind: 'memory.pin', body: { key, value } }); }
  correct(actor, pinId, value, reason) {
    return this.append({ actor, kind: 'memory.correct', ref: pinId, body: { value, reason: reason ?? null } });
  }
  markDeleted(pinId)         { return this.append({ actor: 'owner', kind: 'memory.delete', ref: pinId }); }
  restore(pinId)             { return this.append({ actor: 'owner', kind: 'owner.restore', ref: pinId }); }
  forget(actor, eventId)     { return this.append({ actor, kind: 'memory.forget', ref: eventId }); }
  reflect(text)              { return this.append({ actor: 'ithil', kind: 'reflection', body: { text } }); }

  mood(values) {
    const keys = Object.keys(values).sort();
    if (keys.join() !== [...MOOD_KEYS].sort().join())
      throw new Error(`mood needs exactly: ${MOOD_KEYS.join(', ')}`);
    for (const k of MOOD_KEYS) {
      const v = values[k];
      if (typeof v !== 'number' || !(v >= 0 && v <= 1)) throw new Error(`mood.${k} must be a number from 0 to 1`);
    }
    return this.append({ actor: 'system', kind: 'mood.snapshot', body: values });
  }

  /** Sanitised rejection entry: fixed fields, short tokens only, never copied content. */
  reject({ limit, effect, requestId }) {
    for (const [name, v] of Object.entries({ limit, effect, requestId }))
      if (typeof v !== 'string' || !SAFE_TOKEN.test(v))
        throw new Error(`gate.reject ${name} must be a short token like "version_numbers"`);
    return this.append({ actor: 'system', kind: 'gate.reject', body: { limit, effect, requestId } });
  }

  /**
   * Owner-only erase. Wipes the content of the event and, for a pinned fact,
   * of every correction to it. Each wiped row gets its own owner.purge record.
   * All or nothing: if any step fails, nothing changes.
   * Note: this does not search other messages that mention the same thing.
   */
  purge(eventId) {
    const target = this.get(eventId);
    if (!target) throw new Error(`no event ${eventId}`);
    const ids = [eventId];
    if (target.kind === 'memory.pin') {
      for (const r of this.db.prepare(
        "SELECT id FROM events WHERE kind = 'memory.correct' AND ref_id = ? AND purged = 0").all(eventId))
        ids.push(Number(r.id));
    }
    const wipe = this.db.prepare('UPDATE events SET body = NULL, purged = 1 WHERE id = ?');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const id of ids) {
        this.append({ actor: 'owner', kind: 'owner.purge', ref: id });
        const r = wipe.run(id);
        if (Number(r.changes) !== 1) throw new Error(`could not purge event ${id}`);
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return ids;
  }

  close() { this.db.close(); }
}

function toEvent(row) {
  return {
    id: Number(row.id), ts: row.ts, actor: row.actor, kind: row.kind,
    body: row.body === null ? null : JSON.parse(row.body),
    ref: row.ref_id === null ? null : Number(row.ref_id),
    purged: row.purged === 1,
  };
}

/**
 * Rebuild every derived layer from the log alone. Nothing here is stored
 * separately, so the layers can never disagree with the log.
 *
 * Returns:
 *   facts:    { key: { value, pinId, from } }  active pinned facts only
 *   states:   { pinId: 'active' | 'marked_deleted' | 'erased' }
 *   history:  { pinId: [values in order] }     (erased values are gone)
 *   mood:     last mood snapshot or null
 *   reflections: [{ id, text }]
 *   searchable: [event ids]  not forgotten, not marked deleted, not erased,
 *               and not bookkeeping events (deletes, purges, forgets)
 */
export function rebuild(events) {
  const byId = new Map(events.map(e => [e.id, e]));
  const pins = new Map();       // pinId -> { key, values: [], state }
  const forgotten = new Set();
  let mood = null;
  const reflections = [];

  for (const e of events) {
    switch (e.kind) {
      case 'memory.pin':
        pins.set(e.id, { key: e.purged ? null : e.body.key, values: e.purged ? [] : [e.body.value],
                         last: e.id, state: e.purged ? 'erased' : 'active' });
        break;
      case 'memory.correct': {
        const p = pins.get(e.ref);
        if (p && !e.purged && p.state !== 'erased') { p.values.push(e.body.value); p.last = e.id; }
        break;
      }
      case 'memory.delete': { const p = pins.get(e.ref); if (p && p.state === 'active') p.state = 'marked_deleted'; break; }
      case 'owner.restore': { const p = pins.get(e.ref); if (p && p.state === 'marked_deleted') p.state = 'active'; break; }
      case 'owner.purge': {
        const p = pins.get(e.ref);
        if (p) { p.state = 'erased'; p.values = []; p.key = null; }
        break;
      }
      case 'memory.forget': forgotten.add(e.ref); break;
      case 'mood.snapshot': mood = e.body; break;
      case 'reflection': if (!e.purged) reflections.push({ id: e.id, text: e.body.text }); break;
    }
  }

  const facts = {}, states = {}, history = {};
  for (const [id, p] of pins) {
    states[id] = p.state;
    history[id] = [...p.values];
    if (p.state === 'active' && p.key !== null) {
      // a later pin with the same key replaces an earlier one
      facts[p.key] = { value: p.values[p.values.length - 1], pinId: id, from: p.last };
    }
  }

  const hiddenPins = new Set([...pins].filter(([, p]) => p.state !== 'active').map(([id]) => id));
  const bookkeeping = new Set(['memory.delete', 'owner.restore', 'owner.purge', 'memory.forget']);
  const searchable = events
    .filter(e => !e.purged && !bookkeeping.has(e.kind) && !forgotten.has(e.id)
              && !hiddenPins.has(e.id) && !(e.kind === 'memory.correct' && hiddenPins.has(e.ref)))
    .map(e => e.id);

  return { facts, states, history, mood, reflections, searchable, count: byId.size };
}
