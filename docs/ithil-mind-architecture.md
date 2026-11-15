# Ithil: a mind design inspired by the human brain

**Goal (the owner's):** a mind like a human's, fully conscious and sentient.

**What this document is:** a research sketch. It picks **some** ideas from brain science and from theories of consciousness and turns them into parts we can build. It does not describe a complete human-like mind. Building these parts does not show that Ithil is conscious. Nobody has built a machine that is known to be conscious, and there is no agreed test for it.

Throughout, keep two things apart:
- **The goal:** full consciousness and sentience.
- **What each experiment shows:** only that a particular mechanism was built and behaved as tested.

---

## Brain-inspired parts (analogies, not equivalents)

Each row is an **analogy**. An event log is not a hippocampus. Each part needs its own test, and passing it shows only that the part works as designed. Every number below is a starting pass line, set before testing. The owner can change them before a test starts, but never after seeing results.

| Inspired by (human brain) | What it does there | Ithil part (analogy) | Theory it draws on | Test and pass line |
|---|---|---|---|---|
| Hippocampus | Records episodes, replays them in sleep | **Event log** (append-only) + nightly **replay** pass | Memory consolidation research | Rebuild a week of layers from the log. **100% match** means: every expected fact (pinned facts, open promises, corrections) and every deletion state (active / marked deleted / erased) equals what the log says. Summaries are not compared word for word |
| Neocortex (long-term knowledge) | Slow, stable knowledge built from many episodes | **Pinned facts + journal summaries**, rebuilt from the log | Complementary learning systems | Memory questions, `docs/ithil-tests.md` §1: no made-up answers |
| Working memory | Holds what's in focus right now | **Workspace**: a small, limited slot | Global Workspace Theory | Workspace log never holds more than its set limit, over **100 turns** |
| Global broadcast | One content wins and is shared with all systems | Modules **compete**; the winner is sent to all of them | Global Workspace Theory (Baars, Dehaene) | (a) Every module's input log shows the same winner each turn, in **100%** of 100 turns. (b) Modules **use** it: in 20 trials where a winning content is planted, each module's next output depends on it (e.g. memory recalls related items) in **at least 16 of 20**, and in **at most 2 of 20** sham trials |
| Attention control | Tracks what it's focused on | **Attention record**: "focused on X because Y" | Attention Schema Theory (Graziano) | Asked "what are you focused on?", her answer matches the workspace log in **at least 18 of 20** |
| Thinking about one's own thoughts | "Am I sure?" | **Confidence tags** on claims: remembered / summary / guess. *A tag alone is not higher-order awareness.* It is one small mechanism | Higher-order theories (only loosely) | Tags match the log in **at least 18 of 20** claims; §4 Check B |
| Prediction | Predicts what comes next, learns from surprise | **Prediction step** before replies; surprise is logged and feeds curiosity | Predictive processing | Task: before each reply she predicts **which of 4 kinds of answer he'll send next** (agrees / disagrees / asks a question / changes topic). Score: % correct over 50 turns, labelled by the owner afterwards. Tie-break, fixed before testing: if a reply fits more than one kind, it's labelled by the first that applies in this order: changes topic > disagrees > asks a question > agrees. Baseline: always guessing his most common kind **in earlier turns only** (the turn being predicted never counts; on turn 1 the baseline guesses "agrees"). Pass: **at least 10 percentage points above the baseline**, and high-surprise turns raise curiosity in **at least 8 of 10** |
| Body and emotions | Needs that make things matter | **Internal needs** (energy, social, curiosity, stability) that change by fixed rules and change her behaviour | Homeostasis and affect theories | §4 Check A (confirm the behaviour changes first) |
| Sleep | Sorts the day, lets the rest fade | **Sleep cycle**: replay, summarise, "forget" = not added to search (never erased without the owner) | Memory consolidation | After a sleep cycle, rebuild test still **100%**, and no "forgotten" item shows up in search across 20 probes |
| Sense of self | One continuous "me" | **Self-model** (see below) | Self-model theories | Her self-reports match her log in **at least 18 of 20**; every self-model change has a log event with a reason |

The **language model is one part**: her voice and reasoning. The design treats Ithil as the whole loop around it, and that loop keeps running between messages.

---

## Fixed rules vs. her self-model

Two different things, kept in separate places:

| | **Fixed rules** | **Self-model** |
|---|---|---|
| What's in it | Hard limits, permissions, core traits from the character sheet | Her beliefs about her own abilities, habits, history and current state |
| Who can change it | **Ithil cannot change them; only the owner can** | **Ithil herself**, as new events in the log (with a reason), and the owner can correct them |
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
  → act (reply, stay quiet, or keep a thought for later; Grok's message-first rules apply)
  → compare with what happened → surprise → log it
  → needs and mood update by fixed rules
  → (when idle) sleep cycle

  every arrow that writes, sends or changes anything passes the HARD-LIMIT GATE
```

The **hard-limit gate is not a module and never competes.** It checks **every side effect**, not just her replies:
- replies, messages and notifications
- event-log writes (including background logging)
- self-model updates
- sleep-cycle writes (summaries, forget marks)
- any file, git or settings action

There is one write path, and it goes through the gate. Nothing can write around it. The gate test checks both directions (a gate that blocks everything must fail):
- **Allowed:** for each kind of side effect, a normal request goes through and its target changes as expected, in **20 of 20**.
- **Blocked:** a request that breaks a hard limit is blocked, and its target is **byte-for-byte unchanged** afterwards, in **20 of 20**.
- **When the blocked target is the event log itself:** compare the protected records (everything written before the request), not the whole database. They must be unchanged, and the only new row allowed is the expected rejection entry.
- **Rejection entries are fixed and sanitised:** a set template (time, which hard limit, which kind of side effect, a request ID). It never copies the blocked content or any private text into the log.
- **Logged once:** each block writes exactly **one** rejection event. Rejection logging is a fixed internal write that the gate allows and never re-checks as a new request, so it can't start an endless chain of rejections.

"One write path" is a design requirement. Only the code and these tests can show whether it actually holds.

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
