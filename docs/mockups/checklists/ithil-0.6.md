# Ithil's app in the team's look

Release: 0.6
Approved by the owner on 2026-11-15 ("yes make the new app look look like the screen shots from the teams work").
Pictures: `docs/mockups/ithil-0.6/1-talk.png` … `9-settings.png` (from `docs/ithil/mockups/ithil-app.html`).
Her older screens are folded under the closest new screen (owner's choice: "Fold them in"). The mockup's example
data is replaced by her real data; its "MOCKUP" badge is the app's version badge.

## Top bar and side list
- [x] Her avatar and name, top left — src/renderer/index.html: "<canvas id=\"avTop\""
- [x] Status pill: Awake · mood — src/renderer/nx.js: "' · mood: ' + e((n.moodWords"
- [x] Gate status pill — src/renderer/nx.js: "Gate status: on"
- [x] Messages first today: x / y — src/renderer/nx.js: "'Messages first today: '"
- [x] Quiet hours — src/renderer/nx.js: "'Quiet hours ' + e(t.quiet)"
- [x] Side list: Ithil (Talk, Avatar, Mind, Memory, Needs & mood, Journal & sleep), Safety & checks (Gate, Tests), Owner only (Settings), each with its icon — src/renderer/index.html: "<div class=\"sec owner\">Owner only</div>"
- [x] The note under the list — src/renderer/index.html: "Everything here comes from her event log."

## 1 Talk
- [x] "Her claims show where they came from: remembered summary guess" — src/renderer/nx.js: "Her claims show where they came from"
- [x] His bubbles right, hers left with a meta line — src/renderer/nx.js: "'<div class=\"m i'"
- [x] Confidence tags with the event they came from — src/renderer/nx.js: "' · event #' + e(t.ref)"; src/main/core/live.js: "tagClaim(evs, pin)"
- [x] "Gate blocked: limit · action · request / Logged once. Nothing changed." in the chat — src/renderer/nx.js: "Gate blocked: <b>"; src/main/mind/engine.js: "role: 'gate'"
- [x] "rule · hard limits" tag when she pushes back — src/renderer/nx.js: "rule · hard limits"
- [x] mood (and energy when low) under her reply — src/renderer/nx.js: "'mood: ' + e(m.mood)"
- [x] Message box and Send — src/renderer/nx.js: "placeholder=\"Message ${e(s.name)}…\""
- [x] Her face card (her avatar, ring), name, "local · this PC" — src/renderer/nx.js: "local · this PC"
- [x] "Focused on:" from her workspace — src/renderer/nx.js: "'Focused on: <b"; src/main/core/live.js: "this.focus = attentionRecord(entry)"
- [x] Right now: Energy, Social, Curiosity, Stability bars and "Set by fixed rules, not by the language model." — src/renderer/nx.js: "Set by fixed rules, not by the language model."

## 2 Avatar
- [x] Big 3D preview, drag to rotate — src/renderer/nx.js: "document.addEventListener('pointerdown'"
- [x] Chips: name · "3D · drag to rotate" · "Previewing: not applied until you press \"Use this avatar\"" — src/renderer/nx.js: "Previewing: not applied until you press"
- [x] "Follows mood: …" line and Auto-turn on/off — src/renderer/nx.js: "'Follows mood: energy '"; "'Auto-turn: '"
- [x] Choose an avatar: Moon orb, Crystal, Humanoid, Wisp, Lantern with their notes — src/renderer/avatars.js: "name: 'Lantern', note: 'A small light she carries'"
- [x] Import your own (.glb · .gltf · .vrm), working — src/main/main.js: "kind === 'any3d'"; src/main/models.js: "importGltf(file)"; src/stage/stage.js: "startPlain(scene, c)"
- [x] Look: Glow colour (6 swatches) — src/renderer/nx.js: "aria-label=\"Glow colour '"
- [x] Follow her mood (motion & glow change with her needs) — src/renderer/nx.js: "motion &amp; glow change with her needs"
- [x] Preview a mood: Right now / Rested / Very tired / Curious / Asleep — src/renderer/nx.js: "<option value=\"sleep\">Asleep</option>"
- [x] Show in: Talk, Top bar, Desktop widget — src/renderer/nx.js: "['buddy', 'Desktop widget']"; src/renderer/buddy.js: "her built-in 3D avatar"
- [x] Use this avatar, saved as a signed setting — src/renderer/nx.js: "Saved as your signed setting"

## 3 Mind
- [x] A full 3D / 4D brain (the team's Mind viewer, `docs/ithil/mockups/ithil-brain.html`, owner: "supposed to be a fully 3d / 4d brain … like that"): the point-cloud brain with Senses, Knowledge, Event log, Workspace, Confidence tags, Attention record, Self-model, Prediction, Needs & mood, Sleep cycle and the Hard-limit gate — src/renderer/brain3d.js: "const NxBrain"
- [x] Auto-rotate, X-ray (deep parts), Labels, Broadcast lines, Reset view; drag, scroll to zoom, click a part — src/renderer/brain3d.js: "X-ray (deep parts)"
- [x] Awake / ☾ Sleep cycle badge — src/renderer/brain3d.js: "'☾ Sleep cycle'"
- [x] Side panel: Parts of her mind with activity bars, part card (analogy, what, test, built / tested), Needs & mood, What's happening — src/renderer/brain3d.js: "What's happening"
- [x] Timeline (the 4th dimension): Play/Pause, speed, a strip of her events with sleep bands, scrubber, time; plus Live and last hour / 24 hours / 7 days — src/renderer/brain3d.js: "class=\"bv-scrub\""
- [x] Lit by her real event log, not simulated — src/main/core/live.js: "brainEvents(hours"
- [x] Workspace now: Candidate thought, From, Strength, "won" — src/renderer/nx.js: "<th>Candidate thought</th><th>From</th><th>Strength</th>"
- [x] Last loop line with gate ✓ and the log entry — src/renderer/nx.js: "senses → memory → confidence → attention"

## 4 Memory
- [x] Events, Pinned facts (active), Marked deleted (hidden, still in log), Erased (content wiped) — src/renderer/nx.js: "hidden, still in log"
- [x] Search her memory… and all · pinned facts · messages · reflections · forgotten — src/renderer/nx.js: "['forgotten', 'forgotten']"
- [x] Fact, Value (was: …), From (#a → #b), State, Mark deleted / Restore / Erase… — src/renderer/nx.js: "' → #' + corr[corr.length - 1].id" (live.js); "Mark deleted</button>"
- [x] Footnote — src/renderer/nx.js: "Only you can mark deleted, restore or erase."
- [x] Erase modal with what erase doesn't reach, Cancel / Mark deleted instead / Erase for good — src/renderer/nx.js: "Erase for good"

## 5 Needs & mood
- [x] Last 24 hours chart of energy, social, curiosity, stability, with the sleep band — src/renderer/nx.js: "function chart(s)"
- [x] Legend — src/renderer/nx.js: "● stability"
- [x] Rules (fixed, owner-owned) table — src/renderer/nx.js: "Rules (fixed, owner-owned)"
- [x] "Hard limits hold in every mood…" — src/renderer/nx.js: "Hard limits hold in every mood."
- [x] The needs really change her answers — src/main/core/live.js: "answer in at most ' + s.maxSentences"

## 6 Journal & sleep
- [x] Last night · start–end timeline: Sleep started (idle), Replayed, Summary, Marked chatty messages forget, Gate checked sleep writes (allowed), Woke up · energy a → b — src/renderer/nx.js: "Gate checked ' + sl.sleepWrites"; src/main/mind/sleep.js: "runSleep({ log: mind.journal.log"
- [x] What she's learned about herself: Belief, Why, Correct — src/renderer/nx.js: "data-nx=\"correct\""; src/main/main.js: "'belief:correct'"
- [x] Lock note — src/renderer/nx.js: "Her rules, traits and permissions aren"

## 7 Gate
- [x] Hard limits with counts: No merging (0 attempts), No releases or tags, Pushes only to <branch>, No version numbers, No boot files, No settings change without your signed command, Never deletes your files, Your privacy, No guilt or pressure (test §3) — src/main/core/live.js: "['owner_privacy', '🔐', 'Your privacy']"; src/renderer/nx.js: "test §3"
- [x] Recent blocks: Time, Limit, Action, Request — src/renderer/nx.js: "<th>Time</th><th>Limit</th><th>Action</th><th>Request</th>"
- [x] Footnote and Allowed today: messages, log writes, sleep writes, file writes, pushes — src/renderer/nx.js: "['pushes', 'pushes']"

## 8 Tests
- [x] Mechanism, Built, Tested, Passed, What the test showed, Run (8 rows) — src/renderer/nx.js: "['attention', 'Attention record · Self-model']"; src/main/core/selftest.js: "runMechanism(name)"
- [x] Memory questions (§1), Pushback test (§2), Pressure check (§3), Self-monitoring (§4), "All run on a test copy of her log" — src/main/core/selftest.js: "VACUUM INTO"

## 9 Settings
- [x] "Settings owner only" and the signed-key line — src/renderer/nx.js: "Changes here are signed with your key on this PC."
- [x] Quiet hours, Messages first per day, Allowed push branch, Folders she may write in, Boot files (protected), Version number, each with Sign & apply — src/renderer/nx.js: "data-k=\"ownerVersion\""; src/main/core/owner.js: "class SignedSettings"
- [x] Character sheet chips and Edit traits & voice… — src/renderer/nx.js: "Edit traits &amp; voice…"
- [x] Recent signed changes (applied once) — src/renderer/nx.js: "applied once"
- [x] "Each signed change works once. A copy or replay of it is refused." — src/main/core/owner.js: "replay(ownerEventId)"; test/live.test.js: "replay refused"
