import textwrap

import matplotlib.pyplot as plt
from PIL import Image


def _wrap(text, width=100):
    """Wrap each line of the text, and keep the line breaks."""
    return "\n".join(textwrap.fill(line, width) for line in str(text).strip().splitlines())


def display_report(example, generated_report, true_report, figsize=(6, 6)):
    """
    Show the image with its label, then the generated report and the true report.

    Args:
        example: Dict with "ImagePath" and "Pathology" (and "Indication", if any).
        generated_report: Report text from the model.
        true_report: Report text from the radiologist.
        figsize: Figure size as (width, height).
    """
    plt.figure(figsize=figsize)
    plt.imshow(Image.open(example["ImagePath"]), cmap="gray")
    plt.title(f'Label: {example["Pathology"]}')
    plt.axis("off")
    plt.show()

    if isinstance(example.get("Indication"), str):
        print(f"📋 INDICATION: {example['Indication']}\n")
    print("🤖 GENERATED (MedGemma)")
    print("-" * 60)
    print(_wrap(generated_report))
    print("\n📝 TRUE (radiologist)")
    print("-" * 60)
    print(_wrap(true_report) if true_report else "(none)")
