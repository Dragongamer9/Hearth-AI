# Colibri, Ithil's brain (0.6)

Colibri ([JustVugg/colibri](https://github.com/JustVugg/colibri), Apache-2.0) runs very large mixture-of-experts models
on a normal PC: hot experts on the GPU, warm ones in RAM, cold ones streamed from the NVMe drive. `coli serve` speaks
the OpenAI API (`/v1/chat/completions`, `/v1/models`) on `http://127.0.0.1:8000/v1`. From 0.6 Ithil thinks with it,
and Ollama is her fallback.

## How she finds it

In this order (`findColibri` in `src/main/mind/engines.js`):

1. **Settings › Her brain › Colibri address**, if you typed one.
2. **Hearth OS**: `~/.config/nimbus/ai-engines.json`, written by Hearth OS Server mode (the `hearth-colibri` service).
   She only reads it, never writes it. Any of these shapes works:
   `{"engines": [{"id": "colibri", "baseUrl": "http://127.0.0.1:8000/v1", "model": "qwen36-35b", "cli": "/path/to/coli"}]}`,
   `{"engines": {"colibri": {"url": "…"}}}`, `{"colibri": {"port": 8000}}`. `baseUrl`, `base_url`, `url` or `port`;
   `/v1` is added when it's missing. An entry from this file counts as "managed by Hearth OS": she never stops or starts
   that Colibri, and installing a model only downloads it.
3. `HEARTH_COLIBRI_URL` in the environment.
4. `http://127.0.0.1:8000/v1`.

The `coli` command (for the model list, installing and importing) is found from **Settings** (`colibriCli`), the
registry's `cli`, `PATH`, `~/colibri/c/coli`, `/opt/colibri/c/coli`.

## How the fallback works

`BrainRouter` (same file) sends each request to Colibri first:

| What happens | What she does |
|---|---|
| Colibri isn't installed or isn't running | Ollama answers. Colibri rests 30 s, then 1, 2, 5 minutes if it keeps failing, then is tried again. |
| It answers 5xx / 429, stalls for 60 s, or breaks halfway through an answer | Whatever it streamed is thrown away; Ollama answers the whole request again. Same rest. |
| The request needs something its model can't do (pictures without a vision tower, tool calls on OLMoE / Inkling, a format) | Ollama answers that one request. No rest. |
| Its answer isn't the JSON she asked for | Ollama answers that request. |
| **Ollama only** is picked in Settings | Colibri is never asked. |

Every request carries her whole context (system prompt, memories, the conversation so far), so a switch in the middle
of a conversation is seamless. Each switch is written to `~/HearthAI/brain-engine.jsonl`, printed as `[brain] …`,
shown under **Settings › Her brain › Recent switches**, and becomes a moment in her own day ("My thoughts moved over
to Ollama for a while…").

What always stays on Ollama: **memory search** (embeddings, `nomic-embed-text`; Colibri has none), **Download her brain**
(`ollama pull`), the **tests of her grown generations** during sleep, and **unloading the GPU** for games and ComfyUI.
Colibri has no unload call: when you game, its experts stay where its own planner put them. (TODO for the owner: if
Colibri holds too much VRAM while gaming, Hearth OS's `hearth-colibri` service is the place to pause it; Ithil never
stops a service.)

Requests to Colibri: `stream: true` (tokens per second are measured from the stream), `response_format:
{"type":"json_object"}` for her JSON tasks (Colibri forces valid JSON with a grammar), `enable_thinking: false` where
Ollama got `think: false`, pictures as `image_url` parts, native `tools` when a caller passes them.

## Models

Colibri serves one model at a time. **Settings › Her brain › Colibri models** lists every model Colibri offers: the
live list from `coli setup --list --all --json` when `coli` is installed, or a copy of Colibri's catalog
(`c/setup_catalog.py`, sizes as of 2026-10-02) when it isn't, checked against this PC with Colibri's own rule
(dense part + minimum expert cache in RAM, download on disk). The recommended one is marked. Also listed: the model
Colibri serves now and her grown generations made for Colibri. **Install & use** runs
`coli setup --model <id> --yes --reconfigure --no-browser` (plus `--background` after `coli stop` when Colibri is
yours, `--no-start` when Hearth OS runs it). **Import a GGUF…** runs `coli import` on any GGUF of an architecture
Colibri supports (Qwen3 / 3.5 / 3.6 dense and MoE, Flint, LFM3-VL, DeepSeek V4, GLM-5, MiMo, Kimi K3, Mistral-Large-4 …),
so every size and quant of those can be used.

**For the RTX 5070 (12 GB VRAM) with about 32 GB of RAM:** `qwen36-35b` (Qwen3.6-35B-A3B, int4, 23 GB download,
10 GB RAM minimum, 20 GB to keep every expert in RAM) is what Colibri recommends and the default to install. It runs
fully from RAM with the GPU for the hot experts, has thinking and tool calls, but no vision tower in that container
(her sight stays on her Ollama sight model). Larger "streams from the SSD" models (DeepSeek V4 Flash REAP 85 GB,
GLM-5.3 420 GB …) also start on 32 GB but answer far slower. Note: it isn't an abliterated model; for an uncensored
Ithil on Colibri, import an abliterated Qwen3 / Qwen3.6 GGUF with **Import a GGUF…**.

## Her grown brain and Colibri (0.2 growth)

Her generations are LoRA adapters on `huihui-ai/Huihui-Qwen3-8B-abliterated-v2`, loaded into Ollama as `ithil:gen-N`.
Colibri can't load a LoRA adapter, but it reads a Qwen3 dense GGUF (`coli import`, architecture `qwen3`). So when a new
generation passes her tests (`Growth.forColibri` in `src/main/mind/growth.js`), and **Make each new generation ready
for Colibri** is on:

1. `train.py merged`: the adapter is merged into her base weights on the CPU (bf16, about 16 GB of RAM) and written
   as one GGUF with llama.cpp's `convert_hf_to_gguf.py` (`q8_0`, about 9 GB) in `~/HearthAI/brain/gen-N/`.
2. `coli import ithil-gen-N-q8_0.gguf --out ~/HearthAI/brain/gen-N/ithil-gen-N` (read in place, nothing copied).
3. It appears in **Colibri models** as "Ithil generation N"; **Use with Colibri** runs `coli setup --model-dir` on it.

A failure here never stops her growing or changes which generation she is. While her active generation is a grown one
and Colibri serves something else, she thinks with her grown brain in Ollama (**Think with her grown brain once she
has one**, on by default); when Colibri serves her generation, Colibri answers.

**TODO for the owner (needs his PC):** check that `coli import` accepts the merged 8B GGUF on the installed Colibri
release and that `hearth-colibri` can be pointed at `~/HearthAI/brain/gen-N/ithil-gen-N`. Growing on top of a
Colibri model itself (a LoRA for Qwen3.6-35B-A3B) isn't possible on 12 GB with her current trainer.

## Where to look

- `src/main/mind/engines.js`: discovery, the Colibri client, the router, the model list.
- `src/main/mind/llm.js`: Ollama (the fallback), now with tool calls and tokens/s.
- `test/engines.test.js`: a fake Colibri and a fake Ollama: fallback, mid-stream failure, stalls, tool calls,
  pictures, Ollama only, her grown brain, Colibri coming back, a conversation that switches halfway, the model list,
  settings safety, growth for Colibri.
