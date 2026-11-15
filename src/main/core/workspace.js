'use strict';
// Step 3: the workspace (inspired by Global Workspace Theory; an analogy, not a brain).
//
// Each turn, every module proposes contents with a strength from 0 to 1.
// They compete; the strongest few fit in the small workspace; the single
// winner is broadcast to EVERY module. The hard-limit gate is not a module
// and never competes: actions still go through the gate afterwards.
//
// The trace records each turn so tests (and the brain viewer) can check that
// the workspace stayed within its limit and that every module received the winner.

class Workspace {
  constructor({ capacity = 3, traceSize = 500 } = {}) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('capacity must be a whole number of at least 1');
    this.capacity = capacity;
    this.traceSize = traceSize;
    this.modules = [];
    this.trace = [];
  }

  /** module = { name, propose(input) -> [{content, strength, why?, ref?}], receive(winner, input)? }  (ref = log event it came from) */
  add(module) {
    if (!module || typeof module.name !== 'string' || !module.name) throw new Error('a module needs a name');
    if (this.modules.some(m => m.name === module.name)) throw new Error(`module "${module.name}" already added`);
    this.modules.push(module);
    return this;
  }

  cycle(input = {}) {
    const proposals = [];
    for (const m of this.modules) {
      for (const p of m.propose?.(input) ?? []) {
        if (typeof p?.strength !== 'number' || !(p.strength >= 0 && p.strength <= 1))
          throw new Error(`${m.name}: strength must be a number from 0 to 1`);
        proposals.push(Object.freeze({ content: p.content, strength: p.strength, source: m.name, why: p.why ?? null, ref: p.ref ?? null }));
      }
    }
    // strongest first; ties go to the module added first (deterministic)
    const order = name => this.modules.findIndex(m => m.name === name);
    proposals.sort((a, b) => b.strength - a.strength || order(a.source) - order(b.source));

    const contents = proposals.slice(0, this.capacity);
    const winner = contents[0] ?? null;
    const received = [];
    if (winner) for (const m of this.modules) { m.receive?.(winner, input); received.push(m.name); }

    const entry = Object.freeze({
      turn: (this.trace.at(-1)?.turn ?? 0) + 1,
      winner, contents: Object.freeze(contents), received: Object.freeze(received), considered: proposals.length,
    });
    this.trace.push(entry);
    if (this.trace.length > this.traceSize) this.trace.shift();
    return entry;
  }
}

module.exports = { Workspace };
