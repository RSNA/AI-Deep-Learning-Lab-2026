import json
import re

import matplotlib.pyplot as plt
import numpy as np
from PIL import Image, ImageDraw


def localization_prompt(object_name):
    """
    Make the anatomy localization prompt from Google's MedGemma 1.5 notebook
    (cxr_anatomy_localization_with_hugging_face.ipynb).

    Args:
        object_name: Anatomy to find, for example "right clavicle".

    Returns:
        str: The prompt text.
    """
    return f"""Instructions:
The following user query will require outputting bounding boxes. The format of bounding boxes coordinates is [y0, x0, y1, x1] where (y0, x0) must be top-left corner and (y1, x1) the bottom-right corner. This implies that x0 < x1 and y0 < y1. Always normalize the x and y coordinates the range [0, 1000], meaning that a bounding box starting at 15% of the image width would be associated with an x coordinate of 150. You MUST output a single parseable json list of objects enclosed into ```json...``` brackets, for instance ```json[{{"box_2d": [800, 3, 840, 471], "label": "car"}}, {{"box_2d": [400, 22, 600, 73], "label": "dog"}}]``` is a valid output. Now answer to the user query.

Remember "left" refers to the patient's left side where the heart is and sometimes underneath an L in the upper right corner of the image.

Query:
Where is the {object_name}? Don't give a final answer without reasoning. Output the final answer in the format "Final Answer: X" where X is a JSON list of objects. The object needs a "box_2d" and "label" key. Answer:"""


def pad_to_square(image):
    """
    Pad an 8-bit RGB image with black to a square, with the image in the center.

    Args:
        image: 8-bit PIL Image, for example the output of utils.preprocess.

    Returns:
        PIL Image: Square RGB image.
    """
    array = np.asarray(image.convert("RGB"))
    h, w = array.shape[:2]
    size = max(h, w)
    out = np.zeros((size, size, 3), dtype=np.uint8)
    top, left = (size - h) // 2, (size - w) // 2
    out[top:top + h, left:left + w] = array
    return Image.fromarray(out)


def remove_thinking(response):
    """Remove the thinking trace (the text up to <unused95>), and keep only the answer."""
    if "<unused95>" in response:
        response = response.split("<unused95>", 1)[1]
    return response.strip()


def _valid_box(box):
    """Return True if the box is a dict with "box_2d" = 4 numbers."""
    coords = box.get("box_2d") if isinstance(box, dict) else None
    return isinstance(coords, list) and len(coords) == 4 and all(isinstance(v, (int, float)) for v in coords)


def parse_boxes(response):
    """
    Get the bounding boxes from the last ```json ... ``` block of a response.

    Args:
        response: Model response (with or without the thinking trace).

    Returns:
        list: Dicts with "box_2d" ([y0, x0, y1, x1], 0-1000) and "label". Empty if parsing fails.
    """
    if response.lstrip().startswith("<unused94>") and "<unused95>" not in response:
        return []  # The thinking did not finish, so there is no answer (the trace can repeat the prompt example)
    blocks = re.findall(r"```json(.*?)```", remove_thinking(response), flags=re.DOTALL | re.IGNORECASE)
    if not blocks:
        return []
    try:
        boxes = json.loads(blocks[-1].strip())
    except json.JSONDecodeError:
        return []
    if isinstance(boxes, dict):  # One box without the list brackets
        boxes = [boxes]
    if not isinstance(boxes, list):
        return []
    return [b for b in boxes if _valid_box(b)]


def boxes_on_image(image, boxes, size=512):
    """
    Draw bounding boxes on a copy of an image.

    Args:
        image: Square PIL Image (the image that the model saw).
        boxes: List of dicts with "box_2d" ([y0, x0, y1, x1], 0-1000) and "label".
        size: Output size in pixels.

    Returns:
        PIL Image: RGB image with the boxes.
    """
    canvas = image.convert("RGB").resize((size, size))
    draw = ImageDraw.Draw(canvas)
    colors = ["red", "lime", "cyan", "yellow", "magenta", "orange"]
    for i, box in enumerate(boxes):
        y0, x0, y1, x1 = [v / 1000 * size for v in box["box_2d"]]
        y0, y1 = sorted((y0, y1))  # The model can give the corners in the wrong order
        x0, x1 = sorted((x0, x1))
        color = colors[i % len(colors)]
        draw.rectangle([(x0, y0), (x1, y1)], outline=color, width=3)
        draw.text((x0 + 3, y0 + 3), str(box.get("label", "")), fill=color)
    return canvas


def draw_boxes(image, boxes, size=512, figsize=(7, 7)):
    """
    Draw bounding boxes on an image and show it.

    Args:
        image: Square PIL Image (the image that the model saw).
        boxes: List of dicts with "box_2d" ([y0, x0, y1, x1], 0-1000) and "label".
        size: Display size in pixels.
        figsize: Figure size as (width, height).
    """
    plt.figure(figsize=figsize)
    plt.imshow(boxes_on_image(image, boxes, size))
    plt.axis("off")
    plt.show()
