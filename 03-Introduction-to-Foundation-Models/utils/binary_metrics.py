import re

import pandas as pd

# Allows extra marks around the answer, for example **Final Answer**: "Yes"
_FINAL_ANSWER = re.compile(r"final\s*answer[\s*:\-\"'\[(]*(yes|no)\b", re.IGNORECASE)


def parse_yes_no(text):
    """
    Get the answer from a response that ends with "Final Answer: yes" or "Final Answer: no".

    Args:
        text: Model response.

    Returns:
        str: "yes" or "no" (the last "Final Answer" in the text), or "invalid" if there is none.
    """
    answers = _FINAL_ANSWER.findall(text)
    return answers[-1].lower() if answers else "invalid"


def binary_metrics(results):
    """
    Compute F1 and other metrics for each condition, and the macro F1.

    An "invalid" answer counts as wrong: a false negative for a positive image,
    and a false positive for a negative image.

    Args:
        results: DataFrame with columns "Condition", "Label" ("yes"/"no"), and "Prediction" ("yes"/"no"/"invalid").

    Returns:
        DataFrame: One row per condition, plus a "Macro average" row.
    """
    rows = {}
    for cond, g in results.groupby("Condition", sort=False):
        pos = g["Label"] == "yes"
        pred = g["Prediction"]
        tp = int((pos & (pred == "yes")).sum())
        fn = int((pos & (pred != "yes")).sum())
        fp = int((~pos & (pred != "no")).sum())
        tn = int((~pos & (pred == "no")).sum())
        rows[cond] = {
            "Positives": int(pos.sum()), "TP": tp, "FN": fn, "FP": fp, "TN": tn,
            "Invalid": int((pred == "invalid").sum()),
            "Sensitivity": tp / (tp + fn) if tp + fn else float("nan"),
            "Specificity": tn / (tn + fp) if tn + fp else float("nan"),
            "F1": 2 * tp / (2 * tp + fp + fn) if tp + fp + fn else float("nan"),
        }
    table = pd.DataFrame.from_dict(rows, orient="index")
    counts = ["Positives", "TP", "FN", "FP", "TN", "Invalid"]
    table[counts] = table[counts].astype("Int64")  # Keep counts as integers next to the empty macro cells
    table.loc["Macro average"] = table[["Sensitivity", "Specificity", "F1"]].mean()
    return table


def yes_rate_table(results):
    """
    Show how often the model answers "yes", for each true class and each condition.

    Example: the row "No Finding" and the column "Cardiomegaly" give the fraction of
    No Finding images where the model said yes to cardiomegaly (a false positive rate).
    An "invalid" answer counts as "not yes" here.

    Args:
        results: DataFrame with columns "Pathology", "Condition", and "Prediction".

    Returns:
        DataFrame: True class (rows) x condition (columns).
    """
    is_yes = results["Prediction"] == "yes"
    return is_yes.groupby([results["Pathology"], results["Condition"]], sort=False).mean().unstack()
