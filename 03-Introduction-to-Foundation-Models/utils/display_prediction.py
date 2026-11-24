import matplotlib.pyplot as plt
import numpy as np

def display_prediction(output, example, figsize=(8, 6)):
    """
    Display an image with prediction and label information.

    Args:
        output: Model output containing input_text with image data and generated_text
        example: Example data containing the true label under 'Pathology' key
        figsize: Figure size as (width, height) tuple (default: (8, 6))
    """
    # Show the image of the user message (the last one, if there are several)
    content = output[0]['input_text'][-1]['content']
    images = [item['image'] for item in content if item['type'] == 'image']
    img_arr = np.array(images[-1])
    plt.figure(figsize=figsize)
    plt.imshow(img_arr)
    response = output[0]["generated_text"].strip()
    if len(response) > 80:  # Keep the title short
        response = "..." + response[-77:]
    plt.title(f'Prediction: {response}\nLabel: {example["Pathology"]}')
    plt.axis('off')
    plt.show()
