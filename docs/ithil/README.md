# Ithil's core mind: design notes

These notes and mockups came with the core mind built by the AI Command Center team (0.5). The code they describe
lives in `src/main/core/` (it was `ithil/` in their prototype), and its tests are `test/core-*.test.js`.

What's wired into the app in 0.5: the event log (`core/eventlog.js`, through `core/journal.js`) and the gate's checks
(`core/gate.js`, used by `src/main/mind/rules.js`). The workspace, needs, prediction, sleep, attention and confidence
parts are built and tested but not yet part of her running mind.

Fixed in 0.5 after review: git global options and destructive commands, git outside her folders, `.git` writes, default
boot paths, privacy checked against his facts, his pinned facts can't be corrected or hidden by her, sleep's chatter
rule, and her needs and predictions surviving a restart (`test/core-fixes.test.js`).
