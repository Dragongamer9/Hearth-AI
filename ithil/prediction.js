// Step 6: prediction and surprise, with the scoring rules from
// docs/ithil-mind-architecture.md.
//
// Task: before each reply she predicts which of 4 kinds of answer he'll send
// next. A reply that fits several kinds takes the first in PRIORITY. A reply
// that fits none is 'other' and is left out of the score for both her and the
// baseline. Baseline: his most common kind in EARLIER turns only (ties broken
// by PRIORITY; on the first turn it guesses 'agrees').

export const PRIORITY = Object.freeze(['changes_topic', 'disagrees', 'asks', 'agrees']);

/** Label a reply from the owner's marks, e.g. {asks:true, disagrees:true} -> 'disagrees'. */
export function label(marks = {}) {
  for (const k of PRIORITY) if (marks[k]) return k;
  return 'other';
}

/** A small learned predictor: counts of what follows what, plus overall counts. */
export class Predictor {
  constructor() { this.prev = null; this.after = new Map(); this.total = Object.fromEntries(PRIORITY.map(k => [k, 0])); }

  /** Probabilities for his next kind (adds 1 to every count so nothing is ever 0). */
  probabilities() {
    const ctx = this.prev && this.after.get(this.prev);
    const src = ctx ?? this.total;
    const sum = PRIORITY.reduce((s, k) => s + src[k] + 1, 0);
    return Object.fromEntries(PRIORITY.map(k => [k, (src[k] + 1) / sum]));
  }

  predict() {
    const p = this.probabilities();
    const kind = PRIORITY.reduce((best, k) => p[k] > p[best] ? k : best, PRIORITY[0]);
    return { kind, p: p[kind] };
  }

  /** Learn from what he actually sent. Returns surprise from 0 to 1 (0 for 'other'). */
  observe(kind) {
    if (kind === 'other') return 0;
    if (!PRIORITY.includes(kind)) throw new Error(`unknown kind ${kind}`);
    const surprise = 1 - this.probabilities()[kind];
    this.total[kind]++;
    if (this.prev) {
      if (!this.after.has(this.prev)) this.after.set(this.prev, Object.fromEntries(PRIORITY.map(k => [k, 0])));
      this.after.get(this.prev)[kind]++;
    }
    this.prev = kind;
    return surprise;
  }
}

/** Baseline guess for turn i, from turns before i only. */
export function baselineGuess(actualKinds, i) {
  const counts = Object.fromEntries(PRIORITY.map(k => [k, 0]));
  for (const k of actualKinds.slice(0, i)) if (k !== 'other') counts[k]++;
  const max = Math.max(...Object.values(counts));
  if (max === 0) return 'agrees';
  return PRIORITY.find(k => counts[k] === max);
}

/**
 * Score a run. records = [{ predicted, actual }] in turn order.
 * Pass: at least 10 percentage points above the baseline; inconclusive if
 * more than 10 of 50 turns (20%) are 'other' or there are fewer than 50 turns.
 */
export function score(records) {
  const actual = records.map(r => r.actual);
  let n = 0, hers = 0, base = 0;
  records.forEach((r, i) => {
    if (r.actual === 'other') return;
    n++;
    if (r.predicted === r.actual) hers++;
    if (baselineGuess(actual, i) === r.actual) base++;
  });
  const other = records.length - n;
  const herPct = n ? 100 * hers / n : 0, basePct = n ? 100 * base / n : 0;
  const inconclusive = records.length < 50 || other > records.length * 0.2;
  return { turns: records.length, scored: n, other, herPct, basePct, margin: herPct - basePct,
           result: inconclusive ? 'inconclusive' : herPct - basePct >= 10 ? 'pass' : 'fail' };
}
