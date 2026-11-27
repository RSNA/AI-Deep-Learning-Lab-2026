import os

import matplotlib.pyplot as plt
import numpy as np
from PIL import Image


def dice_score(true, pred):
    """Dice overlap of two binary masks: 2 × |A ∩ B| / (|A| + |B|). 1 = the same mask, 0 = no overlap."""
    total = true.sum() + pred.sum()
    return 2 * np.logical_and(true, pred).sum() / total if total else 1.0


def show_seg_predictions(output_dir, image_dir, fold=0, n=3):
    """
    Show test images with the true mask and the predicted mask.
    Reads the mask files that LinearProbeSegEvaluator saves (save_predictions=True).

    Args:
        output_dir: The output_dir of the evaluator.
        image_dir: The image folder of the dataset (PNG images).
        fold: The test fold to show.
        n: Number of images.
    """
    pred_root = os.path.join(output_dir, "Pred")
    runs = [d for d in sorted(os.listdir(pred_root)) if d.startswith(f"fold{fold}_")]
    if not runs:
        raise ValueError(f"No predicted masks for fold {fold} in {pred_root}. Use a fold that the evaluator ran.")
    run = runs[0]
    names = sorted(os.listdir(os.path.join(pred_root, run)))[:n]

    fig, axes = plt.subplots(len(names), 3, figsize=(10, 3.6 * len(names)), squeeze=False)
    for row, name in zip(axes, names):
        true = np.array(Image.open(os.path.join(output_dir, "GT", run, name))) > 0
        pred = np.array(Image.open(os.path.join(pred_root, run, name))) > 0
        # The model gets the image resized to a square, so we resize it in the same way
        image_path = os.path.join(image_dir, name.replace("__", "/"))
        image = Image.open(image_path).convert("L").resize(true.shape[::-1])

        panels = [
            (None, "Image"),
            (true, "True lung mask"),
            (pred, f"Predicted lung mask (Dice {dice_score(true, pred):.2f})"),
        ]
        for ax, (mask, title) in zip(row, panels):
            ax.imshow(image, cmap="gray")
            if mask is not None:
                ax.imshow(np.ma.masked_where(~mask, mask), cmap="autumn", alpha=0.4)
            ax.set_title(title, fontsize=10)
            ax.axis("off")
    plt.tight_layout()
    plt.show()
