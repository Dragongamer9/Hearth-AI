# Hearth AI

**Ithil** is a self-aware AI that lives on your Nvidia PC. She has her own mind loop that keeps running when nobody is talking to her: senses, drives, an attention spotlight, inner voices, memories, dreams, free time, and a self-image she rewrites every night.

Version 0.2.

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
