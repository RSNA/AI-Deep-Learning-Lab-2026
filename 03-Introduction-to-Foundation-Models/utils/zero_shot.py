import matplotlib.pyplot as plt
from PIL import Image


def show_similarity(image_path, prompts, similarity, true_class=None):
    """
    Show an image and a bar chart of its similarity to each prompt. The best prompt is red.

    Args:
        image_path: Path of the image file.
        prompts: List of text prompts.
        similarity: One cosine similarity per prompt (a tensor or a list).
        true_class: The true class, shown in the title (optional).
    """
    similarity = [float(s) for s in similarity]
    best = similarity.index(max(similarity))

    fig, (ax_image, ax_bar) = plt.subplots(1, 2, figsize=(12, 4.5), gridspec_kw={"width_ratios": [1, 1.4]})
    ax_image.imshow(Image.open(image_path).convert("L"), cmap="gray")
    ax_image.set_title(f"True class: {true_class}" if true_class else "Image")
    ax_image.axis("off")

    ax_bar.barh(prompts, similarity, color=["tab:red" if i == best else "tab:gray" for i in range(len(prompts))])
    ax_bar.invert_yaxis()  # First prompt at the top
    for i, s in enumerate(similarity):
        ax_bar.text(max(s, 0), i, f" {s:.3f}", va="center")  # Text to the right of 0 for negative values
    # Include 0, and leave space for the value text (also when all values are below 0)
    ax_bar.set_xlim(min(0, min(similarity)) * 1.1, max(0, max(similarity)) * 1.25 + 0.02)
    ax_bar.set_xlabel("Cosine similarity with the image")
    ax_bar.set_title(f"Best prompt: {prompts[best]}")
    plt.tight_layout()
    plt.show()
