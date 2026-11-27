"""Build the Lab 07 dataset from the public FracAtlas release.

FracAtlas (Abedeen et al., Scientific Data 2023), CC BY 4.0:
https://doi.org/10.6084/m9.figshare.22363012 (FracAtlas.zip, version 7)

What this script does
1. Reads dataset.csv (image-level labels) and the COCO fracture boxes.
2. Resizes every image so its longest side is at most 512 px (RGB JPEG).
3. Writes the structured report each image should get (see lab07_common.py).
4. Splits by image-ID range, following the authors' own fracture split
   (train IMG0000019-3294, test 3297-3713, valid 3733+). FracAtlas has no
   patient IDs; neighbouring IDs often come from the same patient, so an
   ID-range split is much safer than a random split.
5. Counts near-duplicate images across splits (a leakage check).

Usage
  python prepare_data.py --src data/raw/FracAtlas --out data/fracatlas_vlm
"""

import argparse
import io
import json
from pathlib import Path

import numpy as np
import pandas as pd
from datasets import Dataset, DatasetDict, Features, Image as HFImage, Sequence, Value
from PIL import Image, ImageFile

from lab07_common import BODY_PARTS, VIEWS, format_target

MAX_SIDE = 512
TRAIN_MAX_ID = 3294  # last ID of the authors' train range
TEST_MAX_ID = 3719   # authors' test range is 3297-3713; valid starts at 3733


def split_of(idn: int) -> str:
    if idn <= TRAIN_MAX_ID:
        return "train"
    if idn <= TEST_MAX_ID:
        return "test"
    return "validation"


def load_boxes(coco_path: Path) -> dict[str, list[list[float]]]:
    coco = json.loads(coco_path.read_text())
    id2name = {im["id"]: (im["file_name"], im["width"], im["height"]) for im in coco["images"]}
    boxes: dict[str, list] = {}
    for a in coco["annotations"]:
        name, w, h = id2name[a["image_id"]]
        x, y, bw, bh = a["bbox"]
        # store as fractions of width/height so they survive resizing
        boxes.setdefault(name, []).append([x / w, y / h, bw / w, bh / h])
    return boxes


TRUNCATED: list[str] = []


def resize(path: Path) -> tuple[bytes, int, int]:
    im = Image.open(path)
    try:
        im.load()
    except OSError:  # a few FracAtlas JPEGs are cut short by a few bytes; keep them, but log them
        ImageFile.LOAD_TRUNCATED_IMAGES = True
        im = Image.open(path)
        im.load()
        ImageFile.LOAD_TRUNCATED_IMAGES = False
        TRUNCATED.append(path.name)
    im = im.convert("RGB")
    w, h = im.size
    scale = min(1.0, MAX_SIDE / max(w, h))
    if scale < 1.0:
        im = im.resize((round(w * scale), round(h * scale)), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=95)
    return buf.getvalue(), w, h


def dhash(img_bytes: bytes) -> np.ndarray:
    im = Image.open(io.BytesIO(img_bytes)).convert("L").resize((9, 8), Image.Resampling.BILINEAR)
    a = np.asarray(im, dtype=np.int16)
    return (a[:, 1:] > a[:, :-1]).flatten()


def near_duplicates(df: pd.DataFrame, max_bits: int = 4) -> pd.DataFrame:
    """Pairs of images in different splits whose 64-bit difference hashes differ by <= max_bits."""
    h = np.stack(df["dhash"].to_numpy()).astype(np.uint8)
    split = df["split"].to_numpy()
    rows = []
    for i in range(len(h)):
        d = (h[i + 1:] != h[i]).sum(1)
        for j in np.nonzero(d <= max_bits)[0] + i + 1:
            rows.append((df.image_id.iat[i], df.image_id.iat[j], split[i], split[j], int(d[j - i - 1])))
    out = pd.DataFrame(rows, columns=["a", "b", "split_a", "split_b", "bits"])
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    df = pd.read_csv(args.src / "dataset.csv")
    boxes = load_boxes(args.src / "Annotations" / "COCO JSON" / "COCO_fracture_masks.json")

    records = []
    for r in df.itertuples(index=False):
        sub = "Fractured" if r.fractured else "Non_fractured"
        img_bytes, w, h = resize(args.src / "images" / sub / r.image_id)
        body = ", ".join(p for p in BODY_PARTS if getattr(r, p))
        view = ", ".join(v for v in VIEWS if getattr(r, v))
        idn = int(r.image_id[3:10])
        records.append(
            {
                "image": {"bytes": img_bytes, "path": None},
                "image_id": r.image_id,
                "split": split_of(idn),
                "body_part": body,
                "view": view,
                "hardware": int(r.hardware),
                "fracture": int(r.fractured),
                "fracture_count": int(r.fracture_count),
                "multiscan": int(r.multiscan),
                "orig_width": w,
                "orig_height": h,
                "fracture_boxes": boxes.get(r.image_id, []),
                "target": format_target(body, view, r.hardware, r.fractured),
                "dhash": dhash(img_bytes),
            }
        )
    full = pd.DataFrame(records)
    print(f"Truncated JPEGs kept: {len(TRUNCATED)} {TRUNCATED}")

    print("Images per split and fracture prevalence:")
    print(full.groupby("split").agg(n=("fracture", "size"), fractured=("fracture", "sum"),
                                    hardware=("hardware", "sum")).to_string())
    print("\nBody part by split:")
    print(pd.crosstab(full.body_part, full.split).to_string())

    dups = near_duplicates(full)
    cross = dups[dups.split_a != dups.split_b]
    print(f"\nNear-duplicate pairs (dHash <= 4 bits): {len(dups)} total, {len(cross)} across splits")
    args.out.mkdir(parents=True, exist_ok=True)
    dups.to_csv(args.out / "near_duplicates.csv", index=False)

    features = Features(
        {
            "image": HFImage(),
            "image_id": Value("string"),
            "body_part": Value("string"),
            "view": Value("string"),
            "hardware": Value("int8"),
            "fracture": Value("int8"),
            "fracture_count": Value("int8"),
            "multiscan": Value("int8"),
            "orig_width": Value("int32"),
            "orig_height": Value("int32"),
            "fracture_boxes": Sequence(Sequence(Value("float32"), length=4)),
            "target": Value("string"),
        }
    )
    dd = DatasetDict(
        {
            s: Dataset.from_pandas(
                full[full.split == s].drop(columns=["split", "dhash"]).reset_index(drop=True),
                features=features,
                preserve_index=False,
            )
            for s in ["train", "validation", "test"]
        }
    )
    dd.save_to_disk(str(args.out / "hf"))
    (args.out / "parquet").mkdir(exist_ok=True)
    for s, d in dd.items():
        d.to_parquet(str(args.out / "parquet" / f"{s}.parquet"))
    print("\nSaved:", {s: len(d) for s, d in dd.items()}, "->", args.out)


if __name__ == "__main__":
    main()
