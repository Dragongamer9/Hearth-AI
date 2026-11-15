// Step 7: the sleep cycle. Runs when she has been idle.
// It replays new events, writes a summary and marks short chatter "forget"
// (left out of search, still in the log). Every write goes through the gate.
// It never erases, deletes, corrects or pins anything: the gate only lets
// sleep write summaries and forget marks.

import { rebuild } from './eventlog.js';

/** Default summary: counts only, no copied text, so nothing private is duplicated. */
export function countSummary(events) {
  const c = k => events.filter(e => e.kind === k).length;
  return `Day summary: ${c('owner.message')} messages from the owner, ${c('ithil.message')} replies, `
    + `${c('memory.correct')} corrections, ${c('memory.pin')} new facts, ${c('gate.reject')} gate blocks.`;
}

export function runSleep({ log, gate, sinceId = 0, summarize = countSummary, chatterMaxLength = 12 }) {
  const all = log.all();
  const events = all.filter(e => e.id > sinceId);
  const searchable = new Set(rebuild(all).searchable);
  let forgotten = 0, blocked = 0;
  for (const e of events) {
    const isChat = e.kind === 'owner.message' || e.kind === 'ithil.message';
    const text = String(e.body?.text ?? '').trim();
    if (isChat && !e.purged && !e.body?.command && searchable.has(e.id) && text.length <= chatterMaxLength) {
      gate.request('sleep.write', { kind: 'memory.forget', ref: e.id }).ok ? forgotten++ : blocked++;
    }
  }
  const r = gate.request('sleep.write', { kind: 'reflection', text: summarize(events) });
  if (!r.ok) blocked++;
  return { replayed: events.length, forgotten, summaryId: r.ok ? r.result : null, blocked,
           lastId: events.at(-1)?.id ?? sinceId };
}
