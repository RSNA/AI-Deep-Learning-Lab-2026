"""Fine-tune Qwen3-VL-2B-Instruct with LoRA on the FracAtlas structured-read task.

A thin wrapper around the public Hugging Face recipe (TRL SFTTrainer + PEFT LoRA):
https://huggingface.co/docs/trl/sft_trainer (vision-language section)

What gets trained
- The vision encoder and the projector stay frozen.
- Small LoRA matrices are added to the attention and MLP layers of the language
  model (q/k/v/o, gate/up/down projections). Only these are trained (~1% of weights).
- The loss is computed on the answer tokens only (the prompt and image are context).

Usage (one A100 is plenty; ~10 min for the main run)
  python train_lora.py --data data/fracatlas_vlm/hf --out runs/main
  python train_lora.py --data ... --out runs/lr_high --lr 2e-3
  python train_lora.py --data ... --out runs/n100 --n-train 100 --epochs 20   # overfitting demo
"""

import argparse
import json
from pathlib import Path

import torch
from datasets import load_dataset, load_from_disk
from peft import LoraConfig
from transformers import AutoModelForImageTextToText, AutoProcessor
from trl import SFTConfig, SFTTrainer

from lab07_common import BASE_MODEL_ID, USER_PROMPT


def to_prompt_completion(example: dict) -> dict:
    """One training example: image + instruction (prompt) -> structured report (completion)."""
    return {
        "prompt": [{"role": "user", "content": [{"type": "image"}, {"type": "text", "text": USER_PROMPT}]}],
        "completion": [{"role": "assistant", "content": [{"type": "text", "text": example["target"]}]}],
        "images": [example["image"]],
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, help="save_to_disk dir or Hub dataset id")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--epochs", type=float, default=2)
    ap.add_argument("--rank", type=int, default=16)
    ap.add_argument("--alpha", type=int, default=None, help="default: 2 x rank")
    ap.add_argument("--n-train", type=int, default=None, help="use only the first N (shuffled) training images")
    ap.add_argument("--batch-size", type=int, default=8)
    ap.add_argument("--grad-accum", type=int, default=1)
    ap.add_argument("--eval-steps", type=int, default=25)
    ap.add_argument("--save-steps", type=int, default=0, help="also save adapter checkpoints every N steps")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--precision", default="bf16", choices=["bf16", "fp16"],
                    help="bf16 on A100/H100/L4; fp16 on T4/V100 (no bf16 support)")
    args = ap.parse_args()

    ds = load_from_disk(args.data) if Path(args.data).exists() else load_dataset(args.data)
    train = ds["train"].shuffle(seed=args.seed)
    if args.n_train:
        train = train.select(range(min(args.n_train, len(train))))
    cols = ds["train"].column_names
    train = train.map(to_prompt_completion, remove_columns=cols)
    val = ds["validation"].map(to_prompt_completion, remove_columns=cols)

    model = AutoModelForImageTextToText.from_pretrained(
        BASE_MODEL_ID, dtype=torch.bfloat16 if args.precision == "bf16" else torch.float16,
        attn_implementation="sdpa",
    )
    processor = AutoProcessor.from_pretrained(BASE_MODEL_ID)

    lora = LoraConfig(
        r=args.rank,
        lora_alpha=args.alpha or 2 * args.rank,
        lora_dropout=0.05,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        task_type="CAUSAL_LM",
    )
    config = SFTConfig(
        output_dir=str(args.out),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size,
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.lr,
        lr_scheduler_type="cosine",
        warmup_steps=0.05,  # a fraction = first 5% of steps
        weight_decay=0.0,
        bf16=args.precision == "bf16",
        fp16=args.precision == "fp16",
        gradient_checkpointing=True,
        max_length=None,  # never truncate: image tokens must stay intact
        completion_only_loss=True,  # grade only the answer, not the question
        logging_steps=5,
        eval_strategy="steps",
        eval_steps=args.eval_steps,
        save_strategy="steps" if args.save_steps else "no",
        save_steps=args.save_steps or 500,
        save_total_limit=None,
        report_to="none",
        seed=args.seed,
        dataloader_num_workers=4,
    )
    trainer = SFTTrainer(
        model=model, args=config, train_dataset=train, eval_dataset=val,
        processing_class=processor, peft_config=lora,
    )
    trainable = sum(p.numel() for p in trainer.model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in trainer.model.parameters())
    print(f"trainable params: {trainable:,} / {total:,} ({100 * trainable / total:.2f}%)", flush=True)

    torch.cuda.reset_peak_memory_stats()
    trainer.train()
    peak_gb = torch.cuda.max_memory_allocated() / 1e9
    print(f"peak GPU memory: {peak_gb:.1f} GB", flush=True)
    trainer.save_model(str(args.out / "adapter"))
    processor.save_pretrained(str(args.out / "adapter"))
    meta = vars(args) | {"data": args.data, "out": str(args.out), "n_train_used": len(train),
                         "trainable_params": trainable, "total_params": total,
                         "peak_gpu_memory_gb": round(peak_gb, 2)}
    (args.out / "run_config.json").write_text(json.dumps(meta, indent=2, default=str))
    (args.out / "log_history.json").write_text(json.dumps(trainer.state.log_history, indent=2))


if __name__ == "__main__":
    main()
