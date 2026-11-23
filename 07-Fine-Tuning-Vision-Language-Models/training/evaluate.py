"""Evaluate the base model or base + LoRA adapter on the FracAtlas structured-read task.

For every image it
1. generates the four-line report (greedy decoding), parses it, and
2. measures P(fracture = yes): the model's own answer is cut just after
   "Fracture:" and one forward pass compares the probability of "yes" vs "no".
   This continuous score gives ROC curves and the before/after confidence plots.

Run in float16 to match the free Colab T4 GPU (no bfloat16 on T4).

Usage
  python evaluate.py --data data/fracatlas_vlm/hf --split test --out results/base_test.jsonl
  python evaluate.py --adapter runs/main/adapter --data ... --out results/main_test.jsonl
"""

import argparse
import json
import re
import time
from pathlib import Path

import numpy as np
import torch
from datasets import load_dataset, load_from_disk
from transformers import AutoModelForImageTextToText, AutoProcessor

from lab07_common import BASE_MODEL_ID, FIELDS, build_messages, parse_report

DTYPES = {"fp16": torch.float16, "bf16": torch.bfloat16, "fp32": torch.float32}


def load_model(adapter: str | None, dtype: torch.dtype, base: str = BASE_MODEL_ID):
    model = AutoModelForImageTextToText.from_pretrained(
        base, dtype=dtype, attn_implementation="sdpa", device_map="cuda"
    )
    if adapter:
        from peft import PeftModel

        model = PeftModel.from_pretrained(model, adapter)
        model = model.merge_and_unload()
    model.eval()
    processor = AutoProcessor.from_pretrained(base)
    processor.tokenizer.padding_side = "left"
    return model, processor


def yes_no_token_ids(tokenizer) -> tuple[list[int], list[int]]:
    def ids(words):
        out = set()
        for w in words:
            toks = tokenizer.encode(w, add_special_tokens=False)
            if len(toks) == 1:
                out.add(toks[0])
        return sorted(out)

    return ids([" yes", "yes", " Yes", "Yes"]), ids([" no", "no", " No", "No"])


def fracture_prefix(answer: str) -> str:
    """The model's own answer up to and including 'Fracture:'."""
    m = re.search(r"fracture\s*:", answer, flags=re.IGNORECASE)
    if m:
        return answer[: m.end()]
    rows = [ln for ln in answer.strip().splitlines() if ln.strip()]
    if len(rows) == 4 and ":" not in answer:  # four bare lines: cut before the 4th (fracture) value
        return "\n".join(rows[:3]) + "\n"
    return answer.rstrip() + "\nFracture:"


@torch.inference_mode()
def run_batch(model, processor, images, yes_ids, no_ids, max_new_tokens=48):
    convs = [build_messages(im) for im in images]
    inputs = processor.apply_chat_template(
        convs, tokenize=True, add_generation_prompt=True, return_dict=True,
        return_tensors="pt", processor_kwargs={"padding": True},
    ).to(model.device)
    gen = model.generate(**inputs, max_new_tokens=max_new_tokens, do_sample=False)
    answers = processor.batch_decode(gen[:, inputs["input_ids"].shape[1]:], skip_special_tokens=True)

    # second pass: probability of "yes" right after "Fracture:"
    convs2 = [build_messages(im, fracture_prefix(a)) for im, a in zip(images, answers)]
    inputs2 = processor.apply_chat_template(
        convs2, tokenize=True, continue_final_message=True, return_dict=True,
        return_tensors="pt", processor_kwargs={"padding": True},
    ).to(model.device)
    logits = model(**inputs2).logits[:, -1, :].float()
    probs = torch.softmax(logits, dim=-1)
    p_yes = probs[:, yes_ids].sum(-1)
    p_no = probs[:, no_ids].sum(-1)
    p_frac = (p_yes / (p_yes + p_no).clamp_min(1e-12)).tolist()
    return answers, p_frac, (p_yes + p_no).tolist()


def summarize(rows: list[dict]) -> dict:
    from sklearn.metrics import roc_auc_score

    n = len(rows)
    s = {"n": n, "format_ok": float(np.mean([r["pred"]["format_ok"] for r in rows]))}
    for f in FIELDS:
        s[f"acc_{f}"] = float(np.mean([r["pred"][f] == r["true"][f] for r in rows]))
    y = np.array([r["true"]["fracture"] for r in rows])
    yhat = np.array([r["pred"]["fracture"] == 1 for r in rows])
    s["fracture_sensitivity"] = float(yhat[y == 1].mean()) if (y == 1).any() else None
    s["fracture_specificity"] = float((~yhat[y == 0]).mean()) if (y == 0).any() else None
    p = np.array([r["p_fracture"] for r in rows], dtype=float)
    ok = np.isfinite(p)  # a broken model (e.g. fp16 overflow) gives NaN probabilities
    s["fracture_auc"] = float(roc_auc_score(y[ok], p[ok])) if 0 < y[ok].sum() < ok.sum() else None
    s["p_fracture_nan"] = int((~ok).sum())
    s["fracture_prevalence"] = float(y.mean())
    s["all_fields_correct"] = float(np.mean([all(r["pred"][f] == r["true"][f] for f in FIELDS) for r in rows]))
    return s


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--adapter", default=None, help="LoRA adapter dir or Hub id; omit for the base model")
    ap.add_argument("--data", required=True, help="save_to_disk dir or Hub dataset id")
    ap.add_argument("--split", default="test")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--batch-size", type=int, default=16)
    ap.add_argument("--dtype", default="fp16", choices=DTYPES)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    ds = load_from_disk(args.data)[args.split] if Path(args.data).exists() else load_dataset(args.data, split=args.split)
    if args.limit:
        ds = ds.select(range(min(args.limit, len(ds))))
    model, processor = load_model(args.adapter, DTYPES[args.dtype])
    yes_ids, no_ids = yes_no_token_ids(processor.tokenizer)

    rows, t0 = [], time.time()
    for i in range(0, len(ds), args.batch_size):
        batch = ds[i : i + args.batch_size]
        answers, p_frac, mass = run_batch(model, processor, batch["image"], yes_ids, no_ids)
        for j, a in enumerate(answers):
            true = {
                "body_part": batch["body_part"][j], "view": batch["view"][j],
                "hardware": int(batch["hardware"][j]), "fracture": int(batch["fracture"][j]),
            }
            rows.append({
                "image_id": batch["image_id"][j], "answer": a, "pred": parse_report(a), "true": true,
                "p_fracture": p_frac[j], "yes_no_mass": mass[j],
            })
        print(f"{len(rows)}/{len(ds)}  {time.time() - t0:.0f}s", flush=True)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w") as fh:
        for r in rows:
            fh.write(json.dumps(r) + "\n")
    summary = summarize(rows) | {"adapter": args.adapter, "split": args.split, "dtype": args.dtype,
                                 "seconds": round(time.time() - t0, 1)}
    args.out.with_suffix(".summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
