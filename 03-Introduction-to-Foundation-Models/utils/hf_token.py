import os

from huggingface_hub import get_token, hf_hub_download, whoami
from huggingface_hub.errors import GatedRepoError, HfHubHTTPError


def check_hf_token(in_colab):
    """
    Check that a Hugging Face token is available. In Colab, read the HF_TOKEN secret.

    huggingface_hub reads the Colab secret only once per session. Here we read it
    each time, so you can fix the secret and run the cell again without a restart.

    Args:
        in_colab: True if the notebook runs in Google Colab.

    Raises:
        RuntimeError: If no token is found. The message says what to do.
    """
    if in_colab:
        from google.colab import userdata

        try:
            os.environ["HF_TOKEN"] = userdata.get("HF_TOKEN")  # Asks for access if needed
        except userdata.SecretNotFoundError:
            if get_token() is None:
                raise RuntimeError(
                    "There is no HF_TOKEN secret in Colab. Add it (Step 2, part 4). "
                    "Then run this cell again."
                ) from None
        except userdata.NotebookAccessError:
            if get_token() is None:
                raise RuntimeError(
                    "This notebook has no access to the HF_TOKEN secret. Click the 🔑 Secrets icon, "
                    "and turn on Notebook access for HF_TOKEN (Step 2, part 4). Then run this cell again."
                ) from None

    if get_token() is None:
        raise RuntimeError(
            "No Hugging Face token found. Run `hf auth login` in a terminal, "
            "or `from huggingface_hub import login; login()` in a new cell. Then run this cell again."
        )
    print("✅ Hugging Face token found")


def check_model_access(model_id):
    """
    Check that the token works and that you accepted the model terms.
    Shows your user name, then downloads one small file of the model.

    Args:
        model_id: Hugging Face model ID, for example "google/medgemma-1.5-4b-it".

    Raises:
        RuntimeError: If the token does not work, or if you have no access to the model.
    """
    try:
        print("Logged in as:", whoami()["name"])
    except HfHubHTTPError as e:
        if e.response is None or e.response.status_code != 401:
            raise  # Not a token problem, for example no network
        raise RuntimeError(
            "Your Hugging Face token does not work. Make a new token and save it (Step 2, parts 2–4). "
            "Then run this cell again."
        ) from None
    try:
        hf_hub_download(model_id, "config.json")
    except GatedRepoError:
        raise RuntimeError(
            f"You have no access to {model_id}. Accept the terms on "
            f"https://huggingface.co/{model_id} (Step 2, part 1). Then run this cell again."
        ) from None
    print(f"✅ You have access to {model_id}")
