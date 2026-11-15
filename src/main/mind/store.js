'use strict';
// Ithil's long-term storage. Everything lives as plain files in ~/HearthAI
// (or HEARTH_AI_HOME), so it is easy to back up, inspect, and later use as
// training data for a model of her own.
const fs = require('fs');
const path = require('path');
const os = require('os');

function homeDir() {
  return process.env.HEARTH_AI_HOME || path.join(os.homedir(), 'HearthAI');
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

function writeAtomic(file, data) {
  ensureDir(path.dirname(file));
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function readJSONL(file) {
  try {
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try { return JSON.parse(l); } catch (_) { return null; }
      })
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

let idCounter = 0;
function newId(prefix) {
  idCounter = (idCounter + 1) % 1e6;
  return prefix + '_' + Date.now().toString(36) + '_' + idCounter.toString(36) + Math.random().toString(36).slice(2, 6);
}

// A collection kept fully in memory and written to disk as JSON lines.
class Collection {
  constructor(file, limit) {
    this.file = file;
    this.limit = limit || 0;
    this.items = readJSONL(file);
    this._dirty = false;
  }
  add(item) {
    this.items.push(item);
    if (this.limit && this.items.length > this.limit) {
      this.items.splice(0, this.items.length - this.limit);
      this._dirty = true;
      this.save();
    } else {
      ensureDir(path.dirname(this.file));
      fs.appendFileSync(this.file, JSON.stringify(item) + '\n');
    }
    return item;
  }
  update(id, patch) {
    const it = this.items.find((x) => x.id === id);
    if (!it) return null;
    Object.assign(it, patch);
    this._dirty = true;
    return it;
  }
  remove(id) {
    const n = this.items.length;
    this.items = this.items.filter((x) => x.id !== id);
    if (this.items.length !== n) this._dirty = true;
    return this.items.length !== n;
  }
  replaceAll(items) {
    this.items = items;
    this._dirty = true;
  }
  save() {
    if (!this._dirty) return;
    writeAtomic(this.file, this.items.map((x) => JSON.stringify(x)).join('\n') + (this.items.length ? '\n' : ''));
    this._dirty = false;
  }
  last(n) {
    return this.items.slice(-n);
  }
}

class Store {
  constructor(dir) {
    this.dir = ensureDir(dir || homeDir());
    ensureDir(this.p('dreams'));
    ensureDir(this.p('avatar'));
    ensureDir(this.p('backups'));
    ensureDir(this.p('workspace'));
    ensureDir(this.p('workspace', 'made'));
    this.memories = new Collection(this.p('memories.jsonl'));
    this.thoughts = new Collection(this.p('thoughts.jsonl'), 5000);
    this.chat = new Collection(this.p('chat.jsonl'));
    this.moments = new Collection(this.p('moments.jsonl')); // today's raw experiences, cleared by sleep
    this.decisions = new Collection(this.p('decisions.jsonl'), 500);
    this.dreams = new Collection(this.p('dreams.jsonl'));
    this.tasks = new Collection(this.p('tasks.jsonl'), 300);
    this.wishes = new Collection(this.p('wishes.jsonl'), 200);
    this.made = new Collection(this.p('made.jsonl'), 500);
    this.pushbacks = new Collection(this.p('pushbacks.jsonl'), 200);
    this.bodyEvents = new Collection(this.p('body-events.jsonl'), 300);
    this.surprises = new Collection(this.p('surprises.jsonl'), 300);
    this.selfChanges = new Collection(this.p('self-changes.jsonl'), 300);
    this.predictions = new Collection(this.p('predictions.jsonl'), 1000);
    this.sleeps = new Collection(this.p('sleeps.jsonl'), 400);
    this.checkins = new Collection(this.p('checkins.jsonl'), 200);
    this.selfTests = new Collection(this.p('self-tests.jsonl'), 400);
    this.attentionLog = new Collection(this.p('attention.jsonl'), 5000);
    this.freeTime = new Collection(this.p('free-time.jsonl'), 500);
  }
  p(...parts) {
    return path.join(this.dir, ...parts);
  }
  // 0.5: a file that exists but can't be read is never replaced by defaults. Its last good copy
  // (.bak) is used instead; if that fails too, the broken file is kept aside (never deleted) and
  // the fallback is used. Every write keeps the previous good file as .bak.
  readState(name, fallback) {
    const file = this.p(name + '.json');
    if (!fs.existsSync(file)) {
      const bak = readJSON(file + '.bak', undefined);
      return bak === undefined ? fallback : bak;
    }
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
    const aside = file + '.unreadable-' + Date.now();
    try { fs.copyFileSync(file, aside); } catch (_) {}
    const bak = readJSON(file + '.bak', undefined);
    if (bak !== undefined) { try { writeAtomic(file, JSON.stringify(bak, null, 2)); } catch (_) {} return bak; }
    return fallback;
  }
  writeState(name, value) {
    const file = this.p(name + '.json');
    try { JSON.parse(fs.readFileSync(file, 'utf8')); fs.copyFileSync(file, file + '.bak'); } catch (_) { /* no good file to keep */ }
    writeAtomic(file, JSON.stringify(value, null, 2));
  }
  saveAll() {
    for (const k of Object.keys(this)) {
      if (this[k] instanceof Collection) this[k].save();
    }
  }
}

module.exports = { Store, Collection, homeDir, writeAtomic, readJSON, readJSONL, ensureDir, newId };
