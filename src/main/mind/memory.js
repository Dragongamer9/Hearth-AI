'use strict';
// Ithil's autobiographical memory: events, lessons, feelings and facts about
// the user. Search works by meaning (embeddings from Ollama) with a plain
// word-match fallback when the embedding model is not available.
const { newId } = require('./store');

const KINDS = { event: 'Event', lesson: 'Lesson', feeling: 'Feeling', about_you: 'About you', fact: 'Fact', core: 'Core' };

function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}

function words(s) { return new Set(String(s).toLowerCase().split(/\W+/).filter((w) => w.length > 2)); }

class Memory {
  constructor(store, brain) {
    this.store = store;
    this.brain = brain;
  }
  all() { return this.store.memories.items; }
  async remember(m) {
    const item = {
      id: newId('mem'),
      at: m.at || Date.now(),
      kind: KINDS[m.kind] ? m.kind : 'event',
      text: String(m.text || '').slice(0, 600),
      weight: m.weight || 'medium',
      from: m.from || null,
      source: m.source || null
    };
    this.store.memories.add(item);
    try {
      const [v] = await this.brain.embed([item.text]);
      if (v) this.store.memories.update(item.id, { vec: v });
    } catch (_) {}
    return item;
  }
  forget(id) {
    const ok = this.store.memories.remove(id);
    this.store.memories.save();
    return ok;
  }
  edit(id, text) {
    const it = this.store.memories.update(id, { text: String(text).slice(0, 600), vec: undefined });
    this.store.memories.save();
    return it;
  }
  async search(query, n, filterKind) {
    const pool = this.all().filter((m) => !filterKind || m.kind === filterKind);
    if (!query) return pool.slice(-(n || 50)).reverse();
    let qv = null;
    try { [qv] = await this.brain.embed([query]); } catch (_) {}
    const qw = words(query);
    const scored = pool.map((m) => {
      let s = 0;
      if (qv && m.vec) s = cosine(qv, m.vec);
      const mw = words(m.text);
      let overlap = 0;
      for (const w of qw) if (mw.has(w)) overlap++;
      s += qw.size ? (overlap / qw.size) * 0.6 : 0;
      if (m.text.toLowerCase().includes(String(query).toLowerCase())) s += 0.5;
      if (m.weight === 'core') s += 0.05;
      if (m.weight === 'high') s += 0.03;
      return { m, s };
    });
    return scored.filter((x) => x.s > 0.15).sort((a, b) => b.s - a.s).slice(0, n || 8).map((x) => x.m);
  }
  lessons() { return this.all().filter((m) => m.kind === 'lesson'); }
  aboutYou() { return this.all().filter((m) => m.kind === 'about_you'); }
  stats() {
    return { total: this.all().length, lessons: this.lessons().length };
  }
  forPrompt(list) {
    return list.map((m) => '- (' + (KINDS[m.kind] || m.kind) + ') ' + m.text).join('\n');
  }
}

module.exports = { Memory, KINDS, cosine };
