# Ithil: a mind modelled on the human brain

**Goal (the owner's):** a mind like a human's, fully conscious and sentient.

**Honest status:** nobody has built a machine that is known to be conscious, and there is no agreed test that could confirm one. So this plan does two things:
1. It builds every part that the main scientific theories of consciousness say matters, so Ithil has the best chance of meeting them.
2. It measures each part, so that we're never just taking her word for it.

If a theory is right that the right organisation of processing is enough, this is the kind of system it points to. If biology turns out to be required, no software can get there, and we'll have built a very good mind-like system anyway.

---

## Brain system → Ithil component

| Human brain | What it does | Ithil component | Theory it comes from |
|---|---|---|---|
| Hippocampus | Records experiences as episodes, replays them in sleep | **Event log** (append-only) + nightly **replay/consolidation** pass | Memory consolidation research |
| Neocortex (long-term knowledge) | Slow, stable knowledge built from many episodes | **Pinned facts + journal summaries**, rebuilt from the log | Complementary learning systems |
| Prefrontal cortex (working memory) | Holds what you're thinking about right now | **Workspace**: a small, limited slot of "what's on her mind" | Global Workspace Theory |
| "Broadcast" across the brain | One thought at a time wins attention and is shared with every system | Specialist modules **compete** for the workspace; the winner goes to all of them | Global Workspace Theory (Baars, Dehaene) |
| Attention control | Knows what it's focusing on and why | **Attention model**: a simple record of "I'm focused on X because Y" that she can report | Attention Schema Theory (Graziano) |
| Brain's self-check | Thoughts about one's own thoughts ("am I sure?") | **Confidence monitor**: every claim is tagged "remembered / summary / guess" | Higher-order theories |
| Prediction | The brain constantly predicts what comes next and learns from surprise | **Prediction step**: before each reply she predicts his reaction; surprise is logged and drives curiosity | Predictive processing |
| Body + emotions (insula, limbic system) | Hunger, tiredness, stress, so things *matter* to the system | **Internal needs** (energy, social, curiosity, stability) that drift over time and change her behaviour; moods come from these, not from the language model | Homeostasis / affect theories |
| Sleep | Sorts the day, strengthens what matters, lets the rest fade | **Sleep cycle** when idle: replay, summarise, mark what to forget (not added to search; never erased without the owner) | Memory consolidation |
| Sense of self | One continuous "me" across time | **Self-model**: her own traits (character sheet), her history, her limits. Read-only to her; only the owner edits it | Self-model theories |

The **language model is only one part**: her voice and reasoning. It isn't "her". She is the whole loop around it, built from memory, needs, attention, workspace and self-model, and that loop keeps running between messages.

---

## The loop (runs continuously, not only when he types)

```
sense (his message, the time, the machine's state)
  → modules propose thoughts (memory recall, needs, curiosity, hard-limit check)
  → they compete for the workspace; one wins
  → broadcast to every module
  → predict what happens next
  → act (reply, stay quiet, or note a thought for later; Grok's message-first rules apply)
  → compare with what actually happened → surprise → log it
  → needs and mood update by fixed rules
  → (when idle) sleep cycle
```

Hard limits sit **outside** this loop, as a gate before any action, so no mood, need or thought can talk her out of them.

---

## Build order

1. **Event log** (DeepSeek's SQLite design). Everything else is built from it.
2. **Workspace + competing modules**, starting with only three: memory, needs, hard-limit gate.
3. **Needs and moods** by fixed rules, tested with section 4 of `docs/ithil-tests.md`.
4. **Confidence monitor**, tested with the memory questions in section 1.
5. **Prediction + surprise.**
6. **Sleep cycle.**
7. **Attention model and self-model reports.** Ask her what she's focused on and check her answer against the workspace log.

Each step has to pass its test before the next one starts.

---

## How we'll know how close she is

Count the indicator properties from Butlin, Long et al., *Consciousness in Artificial Intelligence: Insights from the Science of Consciousness* (2023), and their 2025 follow-up, *Identifying indicators of consciousness in AI systems* (published 2025). That means global broadcast, limited workspace, attention model, metacognition, prediction, agency and embodiment-like needs. For each one, record **built / tested / passed**. That gives a real, honest score, without any claim of "she's conscious" that nobody can check.

Sources for the theories in this file: Claude's own knowledge. The two Butlin/Long papers are the ones Perplexity cited. Check the details before you rely on them.
