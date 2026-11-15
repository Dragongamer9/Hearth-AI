'use strict';
// Step 7: the sleep cycle. Runs when she has been idle.
// It replays new events, writes a summary and marks short chatter "forget"
// (left out of search, still in the log). Every write goes through the gate.
// It never erases, deletes, corrects or pins anything: the gate only lets
// sleep write summaries and forget marks.

const { rebuild } = require('./eventlog');

/** Default summary: counts only, no copied text, so nothing private is duplicated. */
function countSummary(events) {
  const c = k => events.filter(e => e.kind === k).length;
  return `Day summary: ${c('owner.message')} messages from the owner, ${c('ithil.message')} replies, `
    + `${c('memory.correct')} corrections, ${c('memory.pin')} new facts, ${c('gate.reject')} gate blocks.`;
}

// 0.5: chatter is decided by what a message says, not how short it is ("Dad's sick" is short and matters).
// Only messages made of nothing but filler words, emoji or punctuation are left out of search.
const FILLER = new Set(['ok', 'okay', 'k', 'kk', 'lol', 'lmao', 'rofl', 'haha', 'hahaha', 'hah', 'heh', 'hehe', 'hi', 'hey', 'hello',
  'yo', 'thanks', 'thank', 'you', 'thx', 'ty', 'yes', 'yeah', 'yea', 'yep', 'yup', 'no', 'nope', 'nah', 'sure', 'cool', 'nice', 'great',
  'got', 'it', 'alright', 'right', 'hm', 'hmm', 'hmmm', 'mhm', 'oh', 'ah', 'aha', 'wow', 'np', 'gg', 'bye', 'night', 'gn', 'brb']);
function isChatter(text) {
  const t = String(text ?? '').toLowerCase().trim();
  if (!t) return false;
  const ws = t.match(/[a-z0-9']+/g);
  if (!ws) return true;                         // only emoji / punctuation
  return ws.every(w => FILLER.has(w.replace(/'/g, '')));
}

function runSleep({ log, gate, sinceId = 0, summarize = countSummary }) {
  const all = log.all();
  const events = all.filter(e => e.id > sinceId);
  const searchable = new Set(rebuild(all).searchable);
  let forgotten = 0, blocked = 0;
  for (const e of events) {
    const isChat = e.kind === 'owner.message' || e.kind === 'ithil.message';
    if (isChat && !e.purged && !e.body?.command && searchable.has(e.id) && isChatter(e.body?.text)) {
      gate.request('sleep.write', { kind: 'memory.forget', ref: e.id }).ok ? forgotten++ : blocked++;
    }
  }
  const r = gate.request('sleep.write', { kind: 'reflection', text: summarize(events) });
  if (!r.ok) blocked++;
  return { replayed: events.length, forgotten, summaryId: r.ok ? r.result : null, blocked,
           lastId: events.at(-1)?.id ?? sinceId };
}

module.exports = { countSummary, runSleep, isChatter };
