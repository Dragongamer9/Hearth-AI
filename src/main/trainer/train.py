#!/usr/bin/env python3
"""Grow Ithil's brain: train a LoRA on her own life (QLoRA, fits a 12 GB GPU).

Prints one JSON object per line so the app can show progress:
  {"stage": "...", "pct": 0-100, "msg": "..."}
"""
import argparse, json, os, random, sys, glob, math, time


def say(stage, pct=None, msg=""):
    print(json.dumps({"stage": stage, "pct": pct, "msg": msg}), flush=True)


def download(args):
    from huggingface_hub import snapshot_download
    say("download", 0, "Downloading her base brain weights (about 16 GB)")
    path = snapshot_download(
        repo_id=args.base_repo, local_dir=args.base_dir,
        allow_patterns=["*.json", "*.safetensors", "*.txt", "*.model", "*.jinja", "tokenizer*", "merges.txt", "vocab*"],
        token=args.hf_token or None,
    )
    say("download", 100, path)


def load_examples(data_dir, max_examples, seed):
    rows = []
    for f in sorted(glob.glob(os.path.join(data_dir, "*.jsonl"))):
        with open(f, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    r = json.loads(line)
                except Exception:
                    continue
                msgs = r.get("messages")
                if not msgs or msgs[-1].get("role") != "assistant" or not str(msgs[-1].get("content", "")).strip():
                    continue
                rows.append(msgs)
    # Keep her most recent life, plus a random sample of older days so she
    # doesn't forget who she was.
    recent = rows[-(max_examples // 2):]
    older = rows[:-(max_examples // 2)] if len(rows) > max_examples // 2 else []
    random.Random(seed).shuffle(older)
    return older[: max_examples - len(recent)] + recent


def train(args):
    import torch
    from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig, Trainer, TrainingArguments
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training

    if not torch.cuda.is_available():
        say("error", None, "No CUDA GPU found. Training needs the Nvidia GPU.")
        sys.exit(2)

    say("prepare", 0, "Reading her life")
    examples = load_examples(args.data_dir, args.max_examples, args.seed)
    if len(examples) < args.min_examples:
        say("error", None, "Only %d examples so far. She needs at least %d." % (len(examples), args.min_examples))
        sys.exit(3)

    tok = AutoTokenizer.from_pretrained(args.base_dir)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token

    def encode(msgs):
        kw = {"enable_thinking": False}
        try:
            prompt = tok.apply_chat_template(msgs[:-1], tokenize=False, add_generation_prompt=True, **kw)
        except TypeError:
            prompt = tok.apply_chat_template(msgs[:-1], tokenize=False, add_generation_prompt=True)
        target = msgs[-1]["content"].strip() + "<|im_end|>\n"
        p = tok(prompt, add_special_tokens=False)["input_ids"]
        t = tok(target, add_special_tokens=False)["input_ids"]
        # Keep the end of long prompts (the most recent context matters most).
        room = args.max_len - len(t)
        if room < 64:
            return None
        p = p[-room:]
        ids = p + t
        labels = [-100] * len(p) + t  # learn only her own words
        return {"input_ids": ids, "labels": labels}

    data = [e for e in (encode(m) for m in examples) if e]
    say("prepare", 100, "%d examples ready" % len(data))

    say("load", 0, "Loading base brain in 4-bit")
    bnb = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=torch.bfloat16, bnb_4bit_use_double_quant=True)
    model = AutoModelForCausalLM.from_pretrained(args.base_dir, quantization_config=bnb, torch_dtype=torch.bfloat16, device_map={"": 0})
    model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
    lora = LoraConfig(r=args.rank, lora_alpha=args.rank * 2, lora_dropout=0.05, bias="none", task_type="CAUSAL_LM",
                      target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"])
    model = get_peft_model(model, lora)
    say("load", 100, "Ready")

    class DS(torch.utils.data.Dataset):
        def __len__(self):
            return len(data)

        def __getitem__(self, i):
            return data[i]

    def collate(batch):
        n = max(len(b["input_ids"]) for b in batch)
        ids = [b["input_ids"] + [tok.pad_token_id] * (n - len(b["input_ids"])) for b in batch]
        lab = [b["labels"] + [-100] * (n - len(b["labels"])) for b in batch]
        att = [[1] * len(b["input_ids"]) + [0] * (n - len(b["input_ids"])) for b in batch]
        return {"input_ids": torch.tensor(ids), "labels": torch.tensor(lab), "attention_mask": torch.tensor(att)}

    steps_total = max(1, math.ceil(len(data) * args.epochs / (args.batch * args.accum)))

    from transformers import TrainerCallback

    class Progress(TrainerCallback):
        def on_log(self, a, state, control, logs=None, **kw):
            pct = round(100 * state.global_step / steps_total)
            say("train", pct, "loss %.3f" % logs.get("loss", float("nan")) if logs and "loss" in logs else "")

        def on_step_end(self, a, state, control, **kw):
            if os.path.exists(args.stop_file):
                control.should_training_stop = True
                say("stopped", None, "Stopped: the GPU was needed")

    targs = TrainingArguments(
        output_dir=os.path.join(args.out_dir, "ckpt"), per_device_train_batch_size=args.batch, gradient_accumulation_steps=args.accum,
        num_train_epochs=args.epochs, learning_rate=args.lr, lr_scheduler_type="cosine", warmup_ratio=0.05,
        logging_steps=5, save_strategy="no", bf16=True, optim="paged_adamw_8bit", report_to=[], gradient_checkpointing=True,
        remove_unused_columns=False,
    )
    trainer = Trainer(model=model, args=targs, train_dataset=DS(), data_collator=collate, callbacks=[Progress()])
    say("train", 0, "Training on %d moments of her life" % len(data))
    trainer.train()
    if os.path.exists(args.stop_file):
        sys.exit(4)
    adapter = os.path.join(args.out_dir, "adapter")
    model.save_pretrained(adapter)
    with open(os.path.join(args.out_dir, "train-info.json"), "w") as fh:
        json.dump({"examples": len(data), "steps": steps_total, "at": time.time()}, fh)
    say("train", 100, adapter)


def to_gguf(args):
    say("convert", 0, "Turning the new growth into an Ollama adapter")
    sys.path.insert(0, os.path.join(args.llama_cpp, "gguf-py"))
    import subprocess
    out = os.path.join(args.out_dir, "adapter.gguf")
    cmd = [sys.executable, os.path.join(args.llama_cpp, "convert_lora_to_gguf.py"), "--base", args.base_dir,
           "--outfile", out, "--outtype", "f16", os.path.join(args.out_dir, "adapter")]
    env = dict(os.environ, PYTHONPATH=os.path.join(args.llama_cpp, "gguf-py"))
    r = subprocess.run(cmd, env=env, capture_output=True, text=True)
    if r.returncode != 0:
        say("error", None, "Conversion failed: " + (r.stderr or r.stdout)[-600:])
        sys.exit(5)
    say("convert", 100, out)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["download", "train", "gguf"])
    ap.add_argument("--base-repo", default="huihui-ai/Huihui-Qwen3-8B-abliterated-v2")
    ap.add_argument("--base-dir", required=True)
    ap.add_argument("--hf-token", default="")
    ap.add_argument("--data-dir")
    ap.add_argument("--out-dir")
    ap.add_argument("--llama-cpp")
    ap.add_argument("--stop-file", default="/tmp/hearth-ai-stop-training")
    ap.add_argument("--max-examples", type=int, default=3000)
    ap.add_argument("--min-examples", type=int, default=150)
    ap.add_argument("--max-len", type=int, default=1024)
    ap.add_argument("--epochs", type=float, default=1.0)
    ap.add_argument("--batch", type=int, default=1)
    ap.add_argument("--accum", type=int, default=8)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--rank", type=int, default=16)
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()
    try:
        {"download": download, "train": train, "gguf": to_gguf}[a.command](a)
    except SystemExit:
        raise
    except Exception as e:  # report every failure in the same shape
        say("error", None, "%s: %s" % (type(e).__name__, e))
        sys.exit(1)
