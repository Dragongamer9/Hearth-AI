'use strict';
// Step 8: the attention record and the self-model.
//
// Attention record: what she is focused on and why, taken straight from the
// workspace trace, so her report can be checked against it.
//
// Self-model: her beliefs about her own abilities and history. She changes it
// with a reason, as a new log entry, through the gate. Her rules, traits and
// permissions are NOT part of it: the gate refuses those (only the owner can).

function attentionRecord(entry) {
  if (!entry?.winner) return Object.freeze({ turn: entry?.turn ?? null, focus: null, because: 'nothing won the workspace', source: null });
  const w = entry.winner;
  return Object.freeze({ turn: entry.turn, focus: w.content, source: w.source,
                         because: w.why ?? `strongest proposal (from ${w.source})` });
}

/** Her current beliefs, rebuilt from the log: { field: { value, reason, eventId } } */
function selfModel(events) {
  const beliefs = {};
  for (const e of events)
    if (e.kind === 'reflection' && !e.purged && e.body?.field)
      beliefs[e.body.field] = { value: e.body.value, reason: e.body.reason, eventId: e.id };
  return beliefs;
}

function updateBelief(gate, field, value, reason) {
  return gate.request('selfmodel.update', { field, value, reason });
}

module.exports = { attentionRecord, selfModel, updateBelief };
