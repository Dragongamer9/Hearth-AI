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
   `/v1` is added when it's missing. Hearth OS (feature/colibri) runs Colibri on **`http://127.0.0.1:11440/v1`**
   (not Colibri's own 8000, so it never meets Ollama) and writes
   `{"default", "colibri": {model, modelsDir}, "engines": [{"id": "ollama", …}, {"id": "colibri", "baseUrl", "model",
   "cli", "setupHome", "modelsDir", "use"}]}`. An entry from this file counts as "managed by Hearth OS": she never stops
   or starts that Colibri herself. **Install & use** runs `coli setup --model ID --yes --reconfigure --no-browser
   --no-start` with `COLI_SETUP_HOME=<setupHome>`, then the registry's `use` command
   (`/usr/bin/python3 /usr/share/nimbus/desktop/shell/hearth-colibri use ID`). A model folder (a downloaded uncensored
   model, an imported GGUF, her grown brain) is `coli import … --out <modelsDir>/<ID>`, then `hearth-colibri use ID
   FOLDER`. Downloaded GGUFs sit in `<modelsDir>/gguf/<ID>/`, the layout `hearth-colibri remove-model` knows.
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

## Uncensored models

**Settings › Her brain › Colibri models** has two groups: **Standard (filtered)** (Colibri's catalog, above) and
**Uncensored**: abliterated GGUF builds (refusals removed) of models Colibri runs, each with every quant its repo has.
The owner wants Ithil uncensored, so the one that fits his PC is marked.

The list is a data file, `src/main/data/ai-models.json` (update it without touching code). When Hearth OS ships its
shared list at `/usr/share/hearth/ai-models.json` (or `HEARTH_AI_MODELS_LIST` names one), that is used instead (it has
more families, exact file sizes in `bytes`, and Colibri's catalog under `standard`, used when `coli` can't be asked); same
shape: `{"updated", "recommend": [{"min_ram_gb", "model", "quant"}], "models": [{"id", "group": "uncensored", "name",
"repo", "arch", "engine", "license", "base", "method", "size": "small"|"large", "summary", "quants": [{"quant", "files":
[…], "download_gb", "ram_min_gb", "ram_good_gb"}]}]}`. Entries with an unsafe repo or file path are dropped.

Checked on Hugging Face on 2026-11-16 (repo, file names and sizes from each repo's file list):

| Model | Repo | Arch (Colibri engine) | Quants | Licence |
|---|---|---|---|---|
| Huihui Qwen3.6-35B-A3B abliterated | `huihui-ai/Huihui-Qwen3.6-35B-A3B-abliterated-MTP-GGUF` | qwen35moe (qwen36) | Q2_K 13.2, Q3_K 17.2, **Q4_K 21.7**, Q5_K 25.3, Q6_K 29.2, Q8_0 37.8, F16 71.1 GB | apache-2.0 |
| Qwen3-30B-A3B abliterated (mlabonne) | `mradermacher/Qwen3-30B-A3B-abliterated-GGUF` | qwen3moe (qwen36) | Q2_K … Q8_0, 11 quants, 11.3–32.5 GB | apache-2.0 |
| Huihui Qwen3-8B abliterated v2 (her Ollama brain today) | `mradermacher/Huihui-Qwen3-8B-abliterated-v2-GGUF` | qwen3 (qwen36) | Q2_K … F16, 12 quants, 3.3–16.4 GB | apache-2.0 |
| Huihui Qwen3.8-Flash-Next abliterated | `huihui-ai/Huihui-Qwen3.8-Flash-Next-abliterated-GGUF` | qwen4exp (qwen38) | UD-IQ4_XS 93.7 GB (3 parts), UD-Q4_K_XL 111 GB (4 parts) | qwen-community-1.0 |

**Recommended for his PC (RTX 5070 12 GB, ~32 GB RAM): Huihui Qwen3.6-35B-A3B abliterated, Q4_K (21.7 GB).** It is
the same model as Colibri's standard pick, at about the same size as Colibri's own int4 container, so it runs fully
from RAM with room left for Ollama's embeddings and the rest of Server mode. RAM figures for these GGUFs are estimates
from the file size (mixture of experts: about 0.43× to start, 0.9× to hold every expert; dense: the file plus 1–2 GB).
The Qwen3.6 GGUF also carries an MTP head; Colibri's qwen36 engine reads the model either way (to be confirmed on his PC).

**Download & use** (his button only; Ithil can't start it): a HEAD request per file for its size and SHA-256, a
disk-space check (everything still to download + 2 GB), then the files over **https only** into
`<modelsDir>/gguf/<model>-<quant>/` (`~/colibri-models` without Hearth OS), as `.part` files resumed with `Range` if stopped, each checked against
its SHA-256 (a mismatch is set aside, never used), then `coli import <first file> --out <modelsDir>/<model>-<quant>`, then
`hearth-colibri use <model>-<quant> <folder>` (or `coli setup --model-dir` without Hearth OS). Pressing it again after a failure resumes.

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
