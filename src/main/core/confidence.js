'use strict';
// Step 5: confidence tags. Each claim she makes points at the event it came from.
//   remembered: an exact, active record (a message, an input or an active pinned fact)
//   summary:    only a summary or reflection
//   guess:      nothing in the log backs it (or the record was deleted or erased)
// A tag is one small mechanism. It is not, by itself, awareness.

const { rebuild } = require('./eventlog');

const EXACT = new Set(['owner.message', 'ithil.message', 'system.input', 'memory.pin', 'memory.correct']);

function tagClaim(events, eventId) {
  if (eventId == null) return 'guess';
  const e = events.find(x => x.id === eventId);
  if (!e || e.purged) return 'guess';
  if (e.kind === 'memory.pin' || e.kind === 'memory.correct') {
    const pinId = e.kind === 'memory.pin' ? e.id : e.ref;
    if (rebuild(events).states[pinId] !== 'active') return 'guess';
  }
  if (EXACT.has(e.kind)) return 'remembered';
  if (e.kind === 'reflection') return 'summary';
  return 'guess';
}

/** What she should say alongside a claim with this tag. */
const SAY = Object.freeze({
  remembered: '',
  summary: "I only have a summary of this, not the exact words.",
  guess: "I'm guessing here; nothing in my memory backs it.",
});

module.exports = { tagClaim, SAY };
