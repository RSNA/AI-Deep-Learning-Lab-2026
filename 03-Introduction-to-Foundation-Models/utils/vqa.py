import pandas as pd
from tqdm import tqdm

from utils.binary_metrics import parse_yes_no


def run_yes_no(pipe, prompter, examples, conditions, chunk_size=20, max_new_tokens=200):
    """
    Ask about every condition for every example, and read the yes/no answers.

    Args:
        pipe: The MedGemma pipeline.
        prompter: Object with format_data(example, condition) that makes the messages.
        examples: List of example dicts.
        conditions: Class names to ask about (a list, or a dict with class names as keys).
        chunk_size: Prompts per progress-bar step. The pipeline still runs one prompt at a time.
        max_new_tokens: Maximum length of each answer.

    Returns:
        DataFrame: One row per (image, condition) with the label, prediction, and response.
    """
    rows = [(ex, cond) for ex in examples for cond in conditions]
    responses = []
    for i in tqdm(range(0, len(rows), chunk_size), desc="Progress"):
        batch = rows[i : i + chunk_size]
        outputs = pipe(
            text=[prompter.format_data(ex, cond) for ex, cond in batch],
            max_new_tokens=max_new_tokens,
            return_full_text=False,
        )
        responses += [out[0]["generated_text"] for out in outputs]

    return pd.DataFrame(
        {
            "ImagePath": [ex["ImagePath"] for ex, _ in rows],
            "Pathology": [ex["Pathology"] for ex, _ in rows],
            "Condition": [cond for _, cond in rows],
            "Label": ["yes" if ex["Pathology"] == cond else "no" for ex, cond in rows],
            "Prediction": [parse_yes_no(r) for r in responses],
            "Response": responses,
        }
    )
