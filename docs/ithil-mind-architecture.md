# Ithil: a mind design inspired by the human brain

**Goal (the owner's):** a mind like a human's, fully conscious and sentient.

**What this document is:** a research sketch. It picks **some** ideas from brain science and from theories of consciousness and turns them into parts we can build. It does not describe a complete human-like mind. Building these parts does not show that Ithil is conscious. Nobody has built a machine that is known to be conscious, and there is no agreed test for it.

Throughout, keep two things apart:
- **The goal:** full consciousness and sentience.
- **What each experiment shows:** only that a particular mechanism was built and behaved as tested.

---

## Brain-inspired parts (analogies, not equivalents)

Each row is an **analogy**. An event log is not a hippocampus. Each part needs its own test, and passing that test shows only that the part works as designed.

| Inspired by (human brain) | What it does there | Ithil part (analogy) | Theory it draws on | How we test the part |
|---|---|---|---|---|
| Hippocampus | Records episodes, replays them in sleep | **Event log** (append-only) + nightly **replay** pass | Memory consolidation research | Rebuild test: the layers rebuilt from the log match the log |
| Neocortex (long-term knowledge) | Slow, stable knowledge built from many episodes | **Pinned facts + journal summaries**, rebuilt from the log | Complementary learning systems | Memory questions, `docs/ithil-tests.md` §1 |
| Working memory | Holds what's in focus right now | **Workspace**: a small, limited slot | Global Workspace Theory | Workspace log shows only N items at a time |
| Global broadcast | One content wins and is shared with all systems | Modules **compete**; the winner is sent to all of them | Global Workspace Theory (Baars, Dehaene) | Every module's input log shows the same winner |
| Attention control | Tracks what it's focused on | **Attention record**: "focused on X because Y" | Attention Schema Theory (Graziano) | Her report matches the workspace log |
| Thinking about one's own thoughts | "Am I sure?" | **Confidence tags** on claims: remembered / summary / guess. *A tag alone is not higher-order awareness.* It is one small mechanism | Higher-order theories (only loosely) | Tags match the log; §1 and §4 Check B |
| Prediction | Predicts what comes next, learns from surprise | **Prediction step** before replies; surprise is logged and feeds curiosity | Predictive processing | Logged predictions vs. outcomes |
| Body and emotions | Needs that make things matter | **Internal needs** (energy, social, curiosity, stability) that change by fixed rules and change her behaviour | Homeostasis and affect theories | §4 Check A (confirm the behaviour changes first) |
| Sleep | Sorts the day, lets the rest fade | **Sleep cycle**: replay, summarise, "forget" = not added to search (never erased without the owner) | Memory consolidation | Rebuild test after a sleep cycle |
| Sense of self | One continuous "me" | **Self-model** (see below) | Self-model theories | Her self-reports match her log |

The **language model is one part**: her voice and reasoning. The design treats Ithil as the whole loop around it, and that loop keeps running between messages.

---

## Fixed rules vs. her self-model

Two different things, kept in separate places:

| | **Fixed rules** | **Self-model** |
|---|---|---|
| What's in it | Hard limits, permissions, core traits from the character sheet | Her beliefs about her own abilities, habits, history and current state |
| Who can change it | **Only the owner** | **Ithil herself**, as new events in the log (with a reason), and the owner can correct them |
| Example | "Never picks a version number" | "I tend to be overconfident about dates. I was wrong 3 times this month." |

Ithil can learn about herself. She can never rewrite her rules.

---

## The loop

```
sense (his message, the time, the machine's state)
  → modules propose contents (memory recall, needs, curiosity, prediction)
  → they compete for the workspace; one wins
  → broadcast to every module
  → predict what happens next
  → HARD-LIMIT GATE (always runs, not part of the competition)
  → act (reply, stay quiet, or keep a thought for later; Grok's message-first rules apply)
  → compare with what happened → surprise → log it
  → needs and mood update by fixed rules
  → (when idle) sleep cycle
```

The **hard-limit gate is not a module and never competes.** It checks every action, whichever thought won, and it can't be outvoted by a mood, need or thought.

---

## Build order

1. **Event log** (DeepSeek's SQLite design). Everything else is built from it.
2. **Hard-limit gate**, wired in front of every action from day one.
3. **Workspace + competing modules**, starting with two: memory and needs.
4. **Needs and moods** by fixed rules. Test: `docs/ithil-tests.md` §4 Check A.
5. **Confidence tags.** Test: §1 and §4 Check B.
6. **Prediction + surprise.**
7. **Sleep cycle.**
8. **Attention record and self-model**, checked against the workspace log.

Each step passes its own test before the next starts.

---

## Tracking progress: which mechanisms we built and tested

For each mechanism, record **built / tested / passed**, and what the test actually showed. This is a list of mechanisms, **not a consciousness score**. In the indicator research we're following, the indicators are evidence to be weighed through theories that are still uncertain. A checklist doesn't add up to "conscious".

| Mechanism | Built | Tested | Passed | What the test showed |
|---|---|---|---|---|
| Event log + rebuild | | | | |
| Hard-limit gate | | | | |
| Workspace + broadcast | | | | |
| Needs → behaviour | | | | |
| Confidence tags | | | | |
| Prediction + surprise | | | | |
| Sleep cycle | | | | |
| Attention record | | | | |
| Self-model updates | | | | |

**Sources:**
- Butlin, Long et al., *Consciousness in Artificial Intelligence: Insights from the Science of Consciousness* (2023).
- Butlin, Long et al., *Identifying indicators of consciousness in AI systems*, Trends in Cognitive Sciences: https://doi.org/10.1016/j.tics.2025.10.011 (link supplied by ChatGPT; not opened by Claude).
- The theory names in the table come from Claude's own knowledge. Check them before relying on details.
