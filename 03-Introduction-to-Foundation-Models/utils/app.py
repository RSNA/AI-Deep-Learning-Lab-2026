import gradio as gr

from utils.localization import boxes_on_image, localization_prompt, pad_to_square, parse_boxes, remove_thinking
from utils.preprocess import preprocess
from utils.report import extract_findings

# Same system prompt as Steps 6–8 in the notebook
SYSTEM_MESSAGE = {"role": "system", "content": [{"type": "text", "text": "You are an expert radiologist."}]}

# Empty VQA answer, generated findings, box image, and localization answer
CLEARED = ("", "", None, "")


def app_image(image):
    """Make an image ready for the model (8-bit RGB). Also works for 16-bit images."""
    if image.mode in ("RGBA", "LA", "P"):  # Remove transparency and color tables
        image = image.convert("RGB")
    return preprocess(image)


def format_report(example):
    """Join the indication, findings, and impression of one sample into one report text. Skip missing parts."""
    parts = [
        ("INDICATION", example["Indication"]),
        ("FINDINGS", example["Findings"]),
        ("IMPRESSION", example["Impression"]),
    ]
    return "\n\n".join(f"{name}: {text}" for name, text in parts if text)


def make_app(pipe, examples, default_index=56):
    """
    Build a Gradio app with an Open-i image list and 3 tabs: VQA, report generation, and anatomy localization.
    The app has its own prompts, so it needs only the pipeline and the samples.

    Args:
        pipe: The MedGemma pipeline.
        examples: List of sample dicts ("ImagePath", "Pathology", "Findings", "Indication", "Impression").
        default_index: Sample that the app shows first.

    Returns:
        gr.Blocks: The app. Start it with demo.launch().
    """

    def generate(model_image, text, max_new_tokens=300):
        """Run the model on one image and one prompt. Return the generated text."""
        messages = [
            SYSTEM_MESSAGE,
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": model_image},
                    {"type": "text", "text": text},
                ],
            },
        ]
        output = pipe(text=messages, max_new_tokens=max_new_tokens, return_full_text=False)
        return output[0]["generated_text"].strip()

    def app_vqa(image, question):
        """Answer a question about the image."""
        if image is None or not question.strip():
            return "Pick or upload an image. Then type a question."
        return remove_thinking(generate(app_image(image), question))  # Some questions start a thinking trace

    def app_report(image, indication):
        """Write the findings, with the same prompt as Step 7 ("<INDICATION> findings:")."""
        if image is None:
            return "Pick or upload an image."
        indication = indication.strip()
        prompt = f"{indication} findings:" if indication else "findings:"
        return extract_findings(generate(app_image(image), prompt))

    def app_localize(image, object_name):
        """Find one body part, with the same prompt as Step 8. Return the image with the box, and the answer."""
        if image is None or not object_name.strip():
            return None, "Pick or upload an image. Then type a body part."
        square = pad_to_square(app_image(image))
        # The model writes about 500 tokens of thinking first, so allow more tokens
        response = generate(square, localization_prompt(object_name), max_new_tokens=1000)
        boxes = [{"box_2d": b["box_2d"], "label": object_name} for b in parse_boxes(response)]
        return boxes_on_image(square, boxes), remove_thinking(response)

    def app_load_example(index):
        """Show one sample, its indication, radiologist report, and label. Clear old answers."""
        example = examples[index]
        label = f"**Label:** {example['Pathology']}"
        return example["ImagePath"], example["Indication"] or "", format_report(example), label, *CLEARED

    def app_upload():
        """Clear the sample text (indication, report, label) and the old answers after you upload your own image."""
        return "", "", "**Label:** none (your own image)", *CLEARED

    gr.close_all()  # Stop the old app if you build the app again
    image_choices = [(f"{i}: {ex['Pathology']}", i) for i, ex in enumerate(examples)]

    with gr.Blocks(title="MedGemma 1.5") as demo:
        gr.Markdown("# MedGemma 1.5\nFor research and education only. Do not use for patient care.")
        with gr.Row():
            with gr.Column():
                image_choice = gr.Dropdown(image_choices, value=default_index, label="Open-i image")
                image_label = gr.Markdown()
                image = gr.Image(type="pil", image_mode=None, label="Chest X-ray (or upload your own)")
                report_true = gr.Textbox(label="Radiologist report", lines=8)

            with gr.Column():
                with gr.Tab("VQA"):
                    vqa_question = gr.Textbox(
                        label="Question", value="What abnormal findings do you see in this chest X-ray?"
                    )
                    vqa_button = gr.Button("Ask", variant="primary")
                    vqa_answer = gr.Textbox(label="Answer", lines=8)

                with gr.Tab("Report generation"):
                    report_indication = gr.Textbox(label="Indication (optional)")
                    report_button = gr.Button("Write findings", variant="primary")
                    report_text = gr.Textbox(label="Generated findings", lines=8)

                with gr.Tab("Anatomy localization"):
                    loc_object = gr.Textbox(label="Body part", value="right lung")
                    loc_button = gr.Button("Find", variant="primary")
                    loc_answer = gr.Textbox(label="Answer", lines=4)
                    loc_result = gr.Image(label="Box (on the square image)")

        # Show the selected Open-i image when the app opens and when you pick an image
        text_outputs = [report_indication, report_true, image_label]
        old_answers = [vqa_answer, report_text, loc_result, loc_answer]
        gr.on(
            [demo.load, image_choice.select],
            app_load_example,
            image_choice,
            [image, *text_outputs, *old_answers],
        )
        image.upload(app_upload, None, [*text_outputs, *old_answers])

        # The 3 tabs share one GPU, so they wait in one queue (one request at a time)
        vqa_button.click(app_vqa, [image, vqa_question], vqa_answer, concurrency_id="model")
        report_button.click(app_report, [image, report_indication], report_text, concurrency_id="model")
        loc_button.click(app_localize, [image, loc_object], [loc_result, loc_answer], concurrency_id="model")

    return demo
