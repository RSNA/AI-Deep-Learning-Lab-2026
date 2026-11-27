"""Shared definitions for the Lab 07 training, evaluation and notebook code.

The prompt, the answer format and the parser live here so that training,
evaluation and the participant notebook all use exactly the same text.
"""

import re

BASE_MODEL_ID = "Qwen/Qwen3-VL-2B-Instruct"

BODY_PARTS = ["hand", "leg", "hip", "shoulder"]
VIEWS = ["frontal", "lateral", "oblique"]
FIELDS = ["body_part", "view", "hardware", "fracture"]

# The same instruction is used for the base model (zero-shot) and the fine-tuned
# model, so any improvement comes from training and not from a better prompt.
USER_PROMPT = (
    "Read this musculoskeletal X-ray and fill in the report.\n"
    "Body part: hand, leg, hip or shoulder (list all that are shown)\n"
    "View: frontal, lateral or oblique (list all that are shown)\n"
    "Hardware: yes or no (orthopedic implant present)\n"
    "Fracture: yes or no\n"
    "Answer with exactly these four lines."
)


def format_target(body_part: str, view: str, hardware: int, fracture: int) -> str:
    """The structured report the model learns to write."""
    return (
        f"Body part: {body_part}\n"
        f"View: {view}\n"
        f"Hardware: {'yes' if hardware else 'no'}\n"
        f"Fracture: {'yes' if fracture else 'no'}"
    )


def build_messages(image, answer: str | None = None) -> list[dict]:
    """Chat messages in the format the Qwen3-VL processor expects."""
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "image", "image": image},
                {"type": "text", "text": USER_PROMPT},
            ],
        }
    ]
    if answer is not None:
        messages.append({"role": "assistant", "content": [{"type": "text", "text": answer}]})
    return messages


def _canonical_list(text: str, vocab: list[str]) -> str | None:
    found = [v for v in vocab if re.search(rf"\b{v}\b", text)]
    return ", ".join(found) if found else None


def _yes_no(text: str) -> int | None:
    m = re.search(r"\b(yes|no|present|absent|none|true|false)\b", text)
    if not m:
        return None
    return int(m.group(1) in ("yes", "present", "true"))


def parse_report(text: str) -> dict:
    """Parse a model answer into fields. Missing or unreadable fields become None.

    Lenient on purpose: a zero-shot model that says "Fracture: Yes, distal radius"
    still counts as "yes", so we measure what the model sees, not only its format.
    """
    out = {f: None for f in FIELDS}
    raw = [ln.strip() for ln in text.strip().lower().splitlines() if ln.strip()]
    lines = {}
    for line in raw:
        if ":" in line:
            key, val = line.split(":", 1)
            lines[key.strip().strip("*- ")] = val.strip()
    out["format_ok"] = all(k in lines for k in ("body part", "view", "hardware", "fracture"))
    if not lines and len(raw) == 4:
        # The base model often answers with four bare lines ("leg / frontal / no / no").
        # Read them by position, but format_ok stays False: the requested format was not followed.
        lines = dict(zip(("body part", "view", "hardware", "fracture"), raw))
    if "body part" in lines:
        out["body_part"] = _canonical_list(lines["body part"], BODY_PARTS)
    if "view" in lines:
        out["view"] = _canonical_list(lines["view"], VIEWS)
    if "hardware" in lines:
        out["hardware"] = _yes_no(lines["hardware"])
    if "fracture" in lines:
        out["fracture"] = _yes_no(lines["fracture"])
    return out
