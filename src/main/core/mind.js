'use strict';
// The loop that ties the parts together (docs/ithil-mind-architecture.md):
//   message in -> modules propose -> workspace competition -> broadcast to all
//   -> prediction -> voice writes a reply -> GATE -> log -> needs update (fixed rules)
//
// The language model is only the `voice`: a function that gets the winning
// focus, the style from her needs and the facts with their confidence tags,
// and returns text. It cannot set moods, write memory or act: its text only
// goes out through gate.request('message.send').
//
// Not connected to a real model yet. offlineVoice says so honestly.

const { Workspace } = require('./workspace');
const { initialNeeds, step, style } = require('./needs');
const { Predictor } = require('./prediction');
const { attentionRecord } = require('./attention');
const { tagClaim } = require('./confidence');
const { rebuild } = require('./eventlog');

const offlineVoice = () =>
  "I'm here, but I'm not connected to a language model yet, so I can't give you a real answer.";

const words = t => new Set(String(t).toLowerCase().match(/[a-z0-9]+/g) ?? []);

class Mind {
  constructor({ log, gate, voice = offlineVoice, capacity = 3, clock = () => Date.now() }) {
    if (!log || !gate) throw new Error('the mind needs the event log and the gate');
    Object.assign(this, { log, gate, voice, clock });
    // 0.5: she picks up where she left off after a restart: her needs from her last mood snapshot
    // (and the time since it), and what she learned about his replies from the log.
    const past = log.all();
    const lastMood = [...past].reverse().find(e => e.kind === 'mood.snapshot' && !e.purged && e.body);
    this.needs = lastMood ? { ...initialNeeds(), ...lastMood.body } : initialNeeds();
    this.lastAt = lastMood ? (Date.parse(lastMood.ts) || clock()) : clock();
    this.predictor = new Predictor();
    for (const e of past) if (e.kind === 'system.input' && !e.purged && typeof e.body?.observedKind === 'string') {
      try { this.predictor.observe(e.body.observedKind); } catch { /* an unknown kind from an older log: skip */ }
    }
    this.received = new Map();       // module name -> last winner it got (broadcast check)
    this.ws = new Workspace({ capacity });
    const recv = name => w => this.received.set(name, w);

    this.ws
      .add({ name: 'input', receive: recv('input'),
             propose: ({ text }) => [{ content: `answer: ${text}`, strength: 0.7, why: 'he asked something' }] })
      .add({ name: 'memory', receive: recv('memory'),
             propose: ({ facts, text }) => {
               const w = words(text);
               return Object.entries(facts)
                 .filter(([k]) => k.split(/[_\s]+/).some(part => w.has(part.toLowerCase())))
                 .map(([k, f]) => ({ content: `recall ${k} = ${f.value}`, strength: 0.75, why: `he mentioned ${k}`, ref: f.from }));
             } })
      .add({ name: 'needs', receive: recv('needs'),
             propose: () => {
               const out = [];
               if (this.needs.energy < 0.35) out.push({ content: 'keep it short', strength: 0.5, why: 'energy is low' });
               if (this.needs.curiosity > 0.65) out.push({ content: 'ask one real question', strength: 0.4, why: 'curiosity is high' });
               return out;
             } })
      .add({ name: 'prediction', receive: recv('prediction'),
             propose: () => { const p = this.predictor.predict();
               return [{ content: `he will probably ${p.kind}`, strength: 0.6 * p.p, why: 'prediction' }]; } });
  }

  /**
   * One turn. ownerEventId: the owner's message, already in the log.
   * observedKind: what kind of message it was (label() in prediction.js), if known.
   */
  turn(ownerEventId, { observedKind = null } = {}) {
    const msg = this.log.get(ownerEventId);
    if (!msg || msg.kind !== 'owner.message' || msg.purged) throw new Error('turn() needs an owner message from the log');

    const now = this.clock(), hours = Math.max(0, (now - this.lastAt) / 3_600_000);
    this.lastAt = now;
    const surprise = observedKind ? this.predictor.observe(observedKind) : 0;
    if (observedKind) this.log.input({ observedKind });   // kept, so a restart doesn't forget what she learned

    const events = this.log.all(), state = rebuild(events);
    const entry = this.ws.cycle({ text: msg.body.text, facts: state.facts });
    const how = style(this.needs);
    const facts = entry.contents.filter(c => c.source === 'memory')
      .map(c => ({ content: c.content, ref: c.ref, tag: tagClaim(events, c.ref) }));
    const prediction = this.predictor.predict();

    const reply = String(this.voice({ message: msg.body.text, focus: entry.winner, contents: entry.contents, style: how, facts }));
    const sent = this.gate.request('message.send', { to: 'owner', text: reply });

    this.needs = step(this.needs, { hours, exchanges: sent.ok ? 1 : 0, surprise, setbacks: sent.ok ? 0 : 1 });
    this.gate.request('mood.snapshot', { values: this.needs });

    return { reply: sent.ok ? reply : null, sent, entry, attention: attentionRecord(entry), style: how, facts,
             needs: { ...this.needs }, prediction, surprise };
  }
}

module.exports = { offlineVoice, Mind };
