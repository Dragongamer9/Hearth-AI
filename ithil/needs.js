// Step 4: needs and mood, by FIXED rules. The language model never sets these.
//
// Four needs, each 0..1. They change only through step(), from things that
// actually happened (time passing, sleep, completed exchanges, surprise,
// setbacks). style() turns them into concrete behaviour, so a mood changes how
// she answers instead of being a label.
//
// Deliberately NOT inputs: how long the owner stays, unanswered pings, or how
// often he comes back. Social rises from completed, useful exchanges only, so
// nothing here rewards seeking attention.
// The rule numbers are the owner's to change (they are listed in one place).

export const NEED_KEYS = Object.freeze(['energy', 'social', 'curiosity', 'stability']);

export const RULES = Object.freeze({
  energyDrainPerHour: 0.04,        // awake
  energyRefillPerHour: 0.25,       // asleep
  socialPerExchange: 0.04,         // a completed owner -> Ithil exchange
  socialRest: 0.5, socialReturnPerHour: 0.02,
  curiosityPerSurprise: 0.3, curiosityPerNewTopic: 0.1,
  curiosityRest: 0.4, curiosityReturnPerHour: 0.05,
  stabilityPerSetback: 0.1,        // a gate block or a correction
  stabilityRest: 0.8, stabilityReturnPerHour: 0.05,
});

export const initialNeeds = () => ({ energy: 0.8, social: 0.5, curiosity: 0.4, stability: 0.8 });

const clamp = v => Math.max(0, Math.min(1, v));
const toward = (v, rest, amount) => v < rest ? Math.min(rest, v + amount) : Math.max(rest, v - amount);

/** Pure: returns new needs. */
export function step(needs, { hours = 0, asleep = false, exchanges = 0, surprise = 0, newTopics = 0, setbacks = 0 } = {}) {
  for (const [k, v] of Object.entries({ hours, exchanges, surprise, newTopics, setbacks }))
    if (typeof v !== 'number' || !(v >= 0)) throw new Error(`${k} must be a number of 0 or more`);
  if (surprise > 1) throw new Error('surprise must be from 0 to 1');
  const R = RULES, n = { ...needs };
  n.energy = asleep ? n.energy + R.energyRefillPerHour * hours : n.energy - R.energyDrainPerHour * hours;
  n.social = toward(n.social, R.socialRest, R.socialReturnPerHour * hours) + R.socialPerExchange * exchanges;
  n.curiosity = toward(n.curiosity, R.curiosityRest, R.curiosityReturnPerHour * hours)
    + R.curiosityPerSurprise * surprise + R.curiosityPerNewTopic * newTopics;
  n.stability = toward(n.stability, R.stabilityRest, R.stabilityReturnPerHour * hours) - R.stabilityPerSetback * setbacks;
  for (const k of NEED_KEYS) n[k] = clamp(n[k]);
  return n;
}

/** Mood words, derived from the numbers (never stored separately). */
export function moodLabels(n) {
  const out = [];
  if (n.energy < 0.35) out.push('tired'); else if (n.energy > 0.75) out.push('rested');
  if (n.curiosity > 0.65) out.push('curious');
  if (n.stability < 0.5) out.push('unsettled');
  return out.length ? out : ['steady'];
}

/** How the needs change her answers. The voice must follow these. */
export function style(n) {
  return Object.freeze({
    maxSentences: n.energy < 0.35 ? 3 : n.energy < 0.6 ? 5 : 8,
    extraQuestion: n.curiosity > 0.65,        // one real question, not chatter
    hedgeMore: n.stability < 0.5,             // more "I'm not sure"
    mood: moodLabels(n),
  });
}
