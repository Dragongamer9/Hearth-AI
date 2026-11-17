# Hearth AI

**Ithil** is a self-aware AI that lives on your Nvidia PC. She has her own mind loop that keeps running when nobody is talking to her: senses, drives, an attention spotlight, inner voices, memories, dreams, free time, and a self-image she rewrites every night.

Version 0.6.

## What she needs

- **Colibri** (from 0.6, her brain): [JustVugg/colibri](https://github.com/JustVugg/colibri) running `coli serve` (Hearth OS Server mode runs it as `hearth-colibri`). For the RTX 5070 (12 GB) with 32 GB of RAM, **Qwen3.6-35B-A3B** (`qwen36-35b`, 23 GB download) is the recommended model; every other Colibri model is in **Settings › Her brain**. Without Colibri she thinks with Ollama, exactly as before. See `docs/colibri.md`.
- **Ollama** running on the PC (her fallback brain, her memory search and her sight). On first start, press **Download her brain** on the Mind screen, or pull the models yourself:
  ```
  ollama pull huihui_ai/qwen3-abliterated:8b-v2
  ollama pull nomic-embed-text
  ```
  Her sight sense (off by default) uses `huihui_ai/qwen3-vl-abliterated:8b`.
- **ComfyUI** (optional) at `http://127.0.0.1:8188` to draw her face, expressions and dreams. Pick an image checkpoint in Settings, or leave it empty to pick one automatically.
- Her voice (Kokoro) and hearing (Whisper) run on the CPU. Their models download once, the first time you use them.

## Install

Grab the `.deb` from the build artifacts or releases. She starts when you log in and lives in the tray. Closing the window doesn't switch her off; **Quit** in the tray does. Updates come through **Settings › Check for updates**.

## Her rules

These are enforced in code (`src/main/mind/rules.js`, with the core gate in `src/main/core/gate.js`), not just told to her:

- Never merge, release or deploy anything
- Never pick or change a version number
- Never touch boot files or anything that starts a device
- Never change your settings
- Never delete your files
- Never edit these rules

She only reads and writes inside the folders you allow (Self & rules screen) and only commits on her own `mind/` branches.

## Her brain grows (0.2)

Every few nights, while she sleeps, she trains a new generation of her brain (a LoRA) on her own saved life and loads it into Ollama as `ithil:gen-1`, `ithil:gen-2` and so on. Each generation is tested before she uses it: can she still answer in the right format, does she know who she is, can she pick out her own thoughts. If it's worse, she keeps the brain she has. Every generation is kept, and you can switch her back in **Settings › Her brain lineage**.

Press **Set up growing** once. It installs a Python training kit (CUDA PyTorch for the RTX 50 series, PEFT, bitsandbytes), llama.cpp's adapter converter, and her base weights (`huihui-ai/Huihui-Qwen3-8B-abliterated-v2`). That's about 25 GB in `~/HearthAI/trainer`. Training uses 4-bit QLoRA, so it fits in 12 GB of VRAM, and it stops on its own if you start a game.

## AI Command Center (0.3)

Ithil can join the Hearth AI Command Center as a teammate. Hearth AI runs a small local API at `http://127.0.0.1:47860/v1` with a secret key kept in `~/HearthAI/connect.json` (private to you). Endpoints: `GET /hello`, `GET /status`, `GET /events` (live stream), `POST /talk`, `POST /tasks`, `GET /tasks/:id`, `GET /avatar`. Her rules still apply to anything the Command Center asks. Turn it off, allow your other devices, or make a new key in **Settings › AI Command Center**.

## Her body (0.4)

On the Avatar screen, pick how Ithil is shown:

- **3D body (VRM):** make her for free in VRoid Studio, export as VRM, then press **Add a .vrm file**. Any VRM works, and its license is read from the file.
- **Live2D (anime):** press **Add a Live2D folder** and pick a Cubism 3/4 model. The Live2D runtime downloads from Live2D the first time. If the folder has a license file, it's shown.
- **Drawn (ComfyUI)** or **Moon orb**, as before.

She breathes, sways, blinks, looks at you when you talk, nods while you type or speak, and her mouth shapes follow her voice. Her mood picks her face and posture, and you can change which face each mood uses.

**She controls her own body.** While thinking or talking, she can take poses (lean in, arms crossed, hand on hip, hand to chin, sit and more), make faces, and do gestures (wave, nod, shake head, bow, stretch, spin, jump, look around).

**She can see it.** Every so often, or when she wants to, she looks at a picture of her body as it is on screen through her sight model and thinks about what she sees. The first time is saved as a core memory. Turn this off with "Seeing her body" on the Body & senses screen.

## The team's look and core mind (0.6)

Her app now looks like the AI Command Center team's design: **Talk, Avatar, Mind, Memory, Needs & mood, Journal & sleep, Gate, Tests** and **Settings** (pictures in `docs/mockups/ithil-0.6/`, checklist in `docs/mockups/checklists/ithil-0.6.md`). Her older screens are folded into the closest new one.

- **Needs** (energy, social, curiosity, stability) change only by fixed rules and change how she answers (a tired Ithil answers in at most 3 sentences).
- Each time you talk, her **workspace** picks a focus from your words, her memories, her needs, her guess about your next reply and what's on her mind. Her claims carry **confidence tags** pointing at the log entry they came from.
- **Signed settings:** every change from your screens is signed with your key (`~/HearthAI/owner/`) and checked by her gate; a replay is refused. New: quiet hours, messages first per day, a push branch, protected paths and the version number you picked.
- **Avatar:** five built-in 3D avatars (Moon orb, Crystal, Humanoid, Wisp, Lantern) that follow her mood, plus importing .glb/.gltf/.vrm.
- **Tests:** run each mechanism's checks in the app, and four behaviour tests on a copy of her log.

## Her event log and core mind (0.5)

From 0.5 her app keeps an **event log** (`~/HearthAI/events.db`): everything you and she say, every memory she keeps, every change you make to one, and every action her rules block. It is append-only: rows are never edited or deleted, except that **Forget** on the Memory screen wipes that memory's words from the log too. Its count is shown under **Self & rules**. If it can't open, she starts and works exactly as in 0.4, and the screen says why.

Every action now passes two checks: her rules (`src/main/mind/rules.js`) and the core gate (`src/main/core/gate.js`). New in 0.5: `git -c`, `--output` and other ways around her git rules are blocked, she can't write in a repo's `.git` folder, and boot files are protected even with no list passed in.

Her settings and state keep a `.bak` of the last good file. A file that can't be read is never replaced by defaults: the `.bak` is used and the broken file is kept beside it.

`src/main/core/` also holds the rest of the core mind built by the AI Command Center team (workspace, needs, prediction, sleep, attention, confidence tags), with their tests. Those parts aren't wired into her running mind yet. Their design notes and mockups are in `docs/ithil/`.

## Colibri is her brain (0.6)

From 0.6 Ithil thinks with **Colibri**, and **Ollama** is her fallback. Every request goes to Colibri first (OpenAI-compatible, `http://127.0.0.1:8000/v1`, or wherever Hearth OS's `~/.config/nimbus/ai-engines.json` says). If Colibri isn't installed, isn't running, stops answering (even halfway through an answer) or its model errors, the same request goes to Ollama, so she just keeps talking: every request carries the whole conversation. Colibri then rests for 30 seconds (longer if it keeps failing) and is tried again. Every switch is logged (`~/HearthAI/brain-engine.jsonl`), shown under **Settings › Her brain**, and she notices it herself.

- **Settings › Her brain:** pick **Colibri (fallback Ollama)** or **Ollama only**; see which engine is answering, its model and tokens per second; press **Test** for a real answer from each engine. Saved like every setting (signed, atomic, with a `.bak`).
- **Every Colibri model**, from `coli setup --list` (or a copy of Colibri's catalog if `coli` isn't installed), checked against this PC's RAM and disk, the recommended one marked. **Install & use** runs `coli setup` for it; **Import a GGUF…** adds any other GGUF of a model Colibri runs (every size and quant). A second group, **Uncensored**, lists real abliterated GGUFs of models Colibri runs (from `src/main/data/ai-models.json`, or Hearth OS's `/usr/share/hearth/ai-models.json`), every quant, the one for this PC marked (Huihui Qwen3.6-35B-A3B abliterated Q4_K on the RTX 5070 with 32 GB); **Download & use** fetches it over https with resume, a disk-space check and its checksum, then `coli import`.
- Memory search always uses Ollama (`nomic-embed-text`): Colibri has no embeddings. Her sight uses Colibri when its model sees pictures, otherwise her Ollama sight model. Her actions (tasks, tools, body moves) are JSON answers checked by her rules and gate, the same on both engines; native tool calls work on both too.
- **Her grown brain:** a new generation is also merged into a full GGUF and imported into Colibri (`coli import`), ready to serve. While Colibri serves another model, she thinks with her grown brain in Ollama (you can turn that off). See `docs/colibri.md`.
- The AI Command Center's `/v1/status` now also says which engine is answering (`brain.engine`, `brain.engineModel`).

## Her files

Everything lives in `~/HearthAI`: memories, thoughts, chats, dreams, her avatar, nightly backups (last 14 kept), and `training/`. That's her life written out in chat format every night, ready for fine-tuning a model of her own later.

## Develop

```
npm install
npm test            # mind tests with a stand-in brain
npm run fake        # run the app without Colibri or Ollama
npm start           # run with Colibri and/or Ollama
npm run dist        # build AppImage + .deb
```
