# Hearth-AI

Ithil: a local AI mind for Dragongamer9's PC, with a memory log, a hard-limit gate and a brain-inspired loop.

**The goal (the owner's):** a mind like a human's, fully conscious and sentient.
**What this repo shows:** that particular mechanisms were built and behave as tested. Passing tests does not show that Ithil is conscious.

**Version 0.5:** core prototype. App integration still to do (model, running service, connection to Hearth, working screens).

Run the tests: `npm test` (Node 22.13 or newer, nothing to install).

## Status

Four levels, kept apart:
- **Mockup:** a picture of how it could look. Not connected to anything.
- **Built + unit-tested:** the code exists, and its tests pass on the owner's PC (`npm test`), run by Claude.
- **Independently reviewed:** someone other than the author read the full code. *Nobody has yet.*
- **Verified with real Ithil:** the behaviour tests in `docs/ithil-tests.md` were run on a running Ithil. *Not possible yet: she isn't connected to a model.*

| Part | File | Level reached | Unit tests |
|---|---|---|---|
| Event log (step 1) | `ithil/eventlog.js` | Built + unit-tested | 14 |
| Hard-limit gate (step 2) | `ithil/gate.js` | Built + unit-tested | 12 |
| Workspace + broadcast (step 3) | `ithil/workspace.js` | Built + unit-tested | 3 |
| Needs and mood rules (step 4) | `ithil/needs.js` | Built + unit-tested | 3 |
| Confidence tags (step 5) | `ithil/confidence.js` | Built + unit-tested | 1 |
| Prediction + surprise (step 6) | `ithil/prediction.js` | Built + unit-tested | 4 |
| Sleep cycle (step 7) | `ithil/sleep.js` | Built + unit-tested | 2 |
| Attention record + self-model (step 8) | `ithil/attention.js` | Built + unit-tested | 2 |
| The loop tying them together | `ithil/mind.js` | Built + unit-tested | 3 |
| Ithil's app (9 screens) | `docs/mockups/ithil-app.html` | Mockup | — |
| 3D brain viewer | `docs/mockups/ithil-brain.html` | Mockup | — |

Unit tests check the code on example data. For instance, "the gate blocks this list of requests" doesn't prove that every possible action in a real app goes through it. That depends on how the app is wired, which still has to be built and reviewed.

## Not done yet

**Needs the owner (decisions only he makes)**
- Fill in Ithil's real traits, voice rules and signature phrases in `docs/ithil-character-sheet.md`. It still has blanks and an example.
- Pick the local language model and runtime to be her voice (for example llama.cpp or Ollama, and which model).
- Version numbers, whenever he wants one.
- Reconnect the teammates that failed (GLM, MiniMax, Groq, FreeBuff, OpenRouter, Amazon Nova, Cerebras, Qwen).

**Still to build**
- Connect the chosen model as `voice` in `ithil/mind.js`. Until then she answers that she isn't connected.
- A small service that runs the mind on the PC, plus its connection to the Hearth AI app. Starting Hearth AI alone doesn't connect this code.
- The owner-side signing key for settings commands: the app keeps the private key, and Ithil gets only the public key.
- Make the mockup screens real (Talk and Memory first), and have the brain viewer read the real log.
- Real 3D avatar import (.glb/.vrm), which needs a 3D loader bundled into the app.

**Still to check**
- An independent review of all the code.
- The behaviour tests in `docs/ithil-tests.md` (memory questions, pushback test, pressure check, self-monitoring) on a running Ithil.

## Files

- `docs/`: character sheet, message-first and mood rules, tests, mind design, mockups
- `ithil/`: the code
- `test/`: unit tests
- `.github/workflows/test.yml`: runs `npm test` on GitHub for every push
