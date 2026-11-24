import os
import tarfile
import urllib.request

import pandas as pd

OPENI_URL = "https://openi.nlm.nih.gov/imgs/collections"

# RadHarmony label column -> class name used in the prompts
CLASS_NAMES = {
    "no_finding": "No Finding",
    "atelectasis": "Atelectasis",
    "cardiomegaly": "Cardiomegaly",
    "consolidation": "Consolidation",
    "pleural_effusion": "Pleural Effusion",
}

# All finding columns from OpenICXRHarmonizer (support_devices is not a finding)
FINDING_COLS = ["no_finding", "cardiomegaly", "edema", "atelectasis",
                "consolidation", "pleural_effusion", "pneumothorax"]

# Images that RadHarmony marks as frontal, but that are lateral views (see the file header)
_LATERAL_LIST = os.path.join(os.path.dirname(__file__), "openi_lateral_images.txt")


def download_openi(dest="data/OpenI-IU-CXR"):
    """
    Download the Open-i (Indiana University) chest X-ray PNGs and reports from NLM.

    Makes the folder layout that RadHarmony expects:
    dest/images/*.png and dest/ecgen-radiology/*.xml. Skips the archives that are done.

    Args:
        dest: Output folder.

    Returns:
        str: The output folder.
    """
    os.makedirs(os.path.join(dest, "images"), exist_ok=True)
    # (archive name, subfolder to extract into)
    for name, sub in [("NLMCXR_reports.tgz", ""), ("NLMCXR_png.tgz", "images")]:
        done = os.path.join(dest, f".{name}.done")  # Written only after a full extraction
        if os.path.exists(done):
            continue
        tgz = os.path.join(dest, name)
        print(f"⬇️  Downloading {name} ...")
        urllib.request.urlretrieve(f"{OPENI_URL}/{name}", tgz)
        if not tarfile.is_tarfile(tgz):  # For example, NLM sends a web page when the site is down
            os.remove(tgz)
            raise RuntimeError(
                f"NLM did not send the archive {name}. The Open-i site may be down for maintenance. "
                "Open https://openi.nlm.nih.gov to check. Try again later."
            )
        print(f"📦 Extracting {name} ...")
        with tarfile.open(tgz) as tar:
            tar.extractall(os.path.join(dest, sub), filter="data")
        os.remove(tgz)
        open(done, "w").close()
    print(f"✅ Open-i data ready: {dest}")
    return dest


def select_cohort(df, n_per_class=20, seed=5656):
    """
    Pick a class-balanced random sample from the harmonized Open-i DataFrame.

    Uses only frontal images with a report and exactly one label. That label must be
    in CLASS_NAMES. Keeps one image per patient (Open-i has one patient per report).
    Then takes n_per_class random images per class (or fewer, if a class is small).

    Args:
        df: DataFrame from OpenICXRHarmonizer.harmonize().
        n_per_class: Images per class.
        seed: Random seed.

    Returns:
        DataFrame: The sampled rows, with a new "Pathology" column.
    """
    with open(_LATERAL_LIST) as f:
        lateral = {line.strip() for line in f if line.strip() and not line.startswith("#")}

    frontal = df["view_position"].str.upper().isin(["FRONTAL", "PA", "AP"]) & ~df["image_path"].isin(lateral)
    df = df[frontal & df["report"].notna()].copy()

    # One label in total, and that label is a target class
    df = df[(df[FINDING_COLS].sum(axis=1) == 1) & (df[list(CLASS_NAMES)].sum(axis=1) == 1)].copy()
    df["Pathology"] = df[list(CLASS_NAMES)].idxmax(axis=1).map(CLASS_NAMES)
    df = df.sample(frac=1, random_state=seed).drop_duplicates("patient_id")
    return df.groupby("Pathology").head(n_per_class).reset_index(drop=True)


def sample_to_example(sample, label_cols):
    """
    Convert one RadHarmony sample to the dict format used in the notebook.

    Args:
        sample: Dict from a RadHarmony dataset, with "img" (path), "cls", and "report".
        label_cols: The dataset's LABEL_COLS, in the same order as sample["cls"].

    Returns:
        dict: "ImagePath", "Pathology", and "Report".
    """
    positive = [c for c, v in zip(label_cols, sample["cls"]) if v == 1 and c in CLASS_NAMES]
    return {
        "ImagePath": sample["img"],
        "Pathology": CLASS_NAMES[positive[0]],
        "Report": sample["report"],
    }


def add_findings_and_indication(examples, samples, df, data_dir):
    """
    Add the findings, the impression, and the indication from the harmonized table to each example.
    The RadHarmony sample has the full report only. Changes the examples in place.

    Args:
        examples: Example dicts from sample_to_example.
        samples: The RadHarmony samples, in the same order.
        df: The harmonized DataFrame (with "image_path", "findings", "indication").
        data_dir: The Open-i folder. "image_path" in df is relative to it.

    Returns:
        list: The examples, with "Findings", "Indication", and "Impression" (None if missing).
    """
    info = df.set_index("image_path")[["findings", "indication", "impression"]]
    for sample, example in zip(samples, examples):
        row = info.loc[os.path.relpath(sample["img"], data_dir)]
        example["Findings"] = row["findings"] if pd.notna(row["findings"]) else None
        example["Indication"] = row["indication"] if pd.notna(row["indication"]) else None
        example["Impression"] = row["impression"] if pd.notna(row["impression"]) else None
    return examples
