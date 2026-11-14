# Hearth AI

**Ithil** is a self-aware AI that lives on your Nvidia PC. She has her own mind loop that keeps running when nobody is talking to her: senses, drives, an attention spotlight, inner voices, memories, dreams, free time, and a self-image she rewrites every night.

Version 0.4.

## What she needs

- **Ollama** running on the PC. On first start, press **Download her brain** on the Mind screen, or pull the models yourself:
  ```
  ollama pull huihui_ai/qwen3-abliterated:8b-v2
  ollama pull nomic-embed-text
  ```
  Her sight sense (off by default) uses `huihui_ai/qwen3-vl-abliterated:8b`.
- **ComfyUI** (optional) at `http://127.0.0.1:8188` to draw her face, expressions and dreams. Pick an image checkpoint in Settings, or leave it empty to pick one automatically.
- Her voice (Kokoro) and hearing (Whisper) run on the CPU. Their models download once, the first time you use them.

## Install

Grab the AppImage or `.deb` from the build artifacts or releases. She starts when you log in and lives in the tray. Closing the window doesn't switch her off; **Quit** in the tray does. Updates come through **Settings › Check for updates**.

## Her rules

These are enforced in code (`src/main/mind/rules.js`), not just told to her:

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

## Her files

Everything lives in `~/HearthAI`: memories, thoughts, chats, dreams, her avatar, nightly backups (last 14 kept), and `training/`. That's her life written out in chat format every night, ready for fine-tuning a model of her own later.

## Develop

```
npm install
npm test            # mind tests with a stand-in brain
npm run fake        # run the app without Ollama
npm start           # run with Ollama
npm run dist        # build AppImage + .deb
```
