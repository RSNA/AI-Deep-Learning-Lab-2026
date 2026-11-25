# Lab 03: An Introduction to Foundation Models in Medical Imaging

**RSNA 2026 Deep Learning Lab**

| | |
| --- | --- |
| **Date** | Monday, November 30, 2026 |
| **Time** | 8:00 – 9:00 AM (U.S. Central Time) |
| **Level** | Core |

> Dates and times may change. Please check the official RSNA 2026 Annual Meeting program for the latest schedule.

## Faculty

- **Moderator:** Judy Gichoya, MD FSIIM — Emory University
- **Presenter:** Mohammadreza Chavoshi, MD — Emory University
- **Presenter:** Frank Li, PhD — Emory University

## Overview

This introductory session covers the main concepts of foundation models in radiology. By the end of the session, participants should understand what foundation models are, how they differ from other models, and why they are gaining popularity.

A hands-on notebook lets participants load a sample foundation model and use it for a set of defined tasks. No prior knowledge of the topic is assumed, so the content is kept at a basic level.

## Learning Objectives

By the end of this session, participants will be able to:

1. Define what a foundation model is in the context of radiology.
2. Differentiate foundation models from traditional machine learning models.
3. Describe the key mechanisms underlying how foundation models work.
4. Identify the main types of foundation models and their applications.
5. Apply a foundation model to a set of defined tasks using a hands-on coding notebook.

## Materials

Notebook 1 uses MedGemma 1.5 (`google/medgemma-1.5-4b-it`). This model reads a chest X-ray and writes text. Notebook 2 uses MedSigLIP (`google/medsiglip-448`). MedGemma uses the image encoder of MedSigLIP.

| Notebook | What it does | Colab |
| --- | --- | --- |
| `1_medgemma_demo.ipynb` | Data download, Hugging Face access, VQA and classification, report generation, anatomy localization, web app (bonus) | [![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/RSNA/AI-Deep-Learning-Lab-2026/blob/main/03-Introduction-to-Foundation-Models/1_medgemma_demo.ipynb) |
| `2_medsiglip_demo.ipynb` (bonus) | MedSigLIP image encoder with RadHarmony evaluators: zero-shot classification, linear probing, lung segmentation | [![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/RSNA/AI-Deep-Learning-Lab-2026/blob/main/03-Introduction-to-Foundation-Models/2_medsiglip_demo.ipynb) |

The session covers only notebook 1. Notebook 2 is a bonus that you can do after the session.

## Before the Session

- Bring a laptop with a recent version of the [Chrome browser](https://www.google.com/chrome/).
- Make sure you can sign in to a Google account, which you need to run notebooks in [Google Colab](https://colab.research.google.com/).
- Complete **Step 2 in notebook 1**. Open the notebook with the **Open in Colab** link above. You do not need to run any cell for this step. In this step, you accept the MedGemma 1.5 terms, make a Hugging Face token, and save it in Colab. For notebook 2 (bonus), also accept the terms on the [MedSigLIP page](https://huggingface.co/google/medsiglip-448).

## How to Run the Notebooks in Colab

1. Open a notebook in Colab. Before you run any cell, select **Runtime → Change runtime type → T4 GPU**. The T4 GPU is free in Colab.
2. Run the first code cell. It gets the helper code and downloads the data. This takes a few minutes. If you did not do Step 2 before the session, do it now.
3. Run the other cells. The Step 3 cell (Setup) installs the packages, including [RadHarmony](https://github.com/f10409/RadHarmony). Then it checks the GPU, your Hugging Face token, and your access to the model. When Colab asks for access to the `HF_TOKEN` secret, click **Grant access**.

## Data

Both notebooks use the open-access [Open-i Indiana University chest X-ray collection](https://openi.nlm.nih.gov/faq) (3,955 reports, 7,470 images). The notebooks download it (about 1.4 GB) and load it with RadHarmony. If the NLM site is down, the notebooks download an unchanged copy of the same Open-i files from Google Drive. Open-i is shared under the [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/) license.

Notebook 2 also uses the [Montgomery County chest X-ray set](https://data.lhncbc.nlm.nih.gov/public/Tuberculosis-Chest-X-ray-Datasets/Montgomery-County-CXR-Set/MontgomerySet/index.html) (138 images with lung masks) for segmentation. The notebook downloads it (about 0.6 GB) and loads it with RadHarmony.

## References

Models: MedGemma and MedSigLIP from Google Health (code on GitHub: [MedGemma](https://github.com/Google-Health/medgemma), [MedSigLIP](https://github.com/Google-Health/medsiglip)).

- Sellergren A, et al. An open vision-language model for diverse medical applications. *Nat Med*. 2026;32(10):3695–3704. [doi:10.1038/s41591-026-04626-w](https://doi.org/10.1038/s41591-026-04626-w). Preprint: MedGemma Technical Report, [arXiv:2507.05201](https://arxiv.org/abs/2507.05201).
- Sellergren A, et al. MedGemma 1.5 Technical Report. *arXiv*. 2026. [arXiv:2604.05081](https://arxiv.org/abs/2604.05081).

Data:

- Demner-Fushman D, et al. Preparing a collection of radiology examinations for distribution and retrieval. *JAMIA*. 2016;23(2):304–310.
- Jaeger S, et al. Two public chest X-ray datasets for computer-aided screening of pulmonary diseases. *Quant Imaging Med Surg*. 2014;4(6):475–477.
- Candemir S, et al. Lung segmentation in chest radiographs using anatomical atlases with nonrigid registration. *IEEE Trans Med Imaging*. 2014;33(2):577–590.

## Optional: Run on Your Own Computer

You do not need this for the session. You need an NVIDIA GPU and [uv](https://docs.astral.sh/uv/).

```bash
git clone --filter=blob:none --sparse https://github.com/RSNA/AI-Deep-Learning-Lab-2026.git
cd AI-Deep-Learning-Lab-2026
git sparse-checkout set 03-Introduction-to-Foundation-Models
cd 03-Introduction-to-Foundation-Models
uv sync
source .venv/bin/activate
python -m ipykernel install --user --name medgemma
```

Log in to Hugging Face with `hf auth login`. Then open the notebooks in Jupyter or VS Code, and select the `medgemma` kernel. The data downloads to `data/`.

---

[← Back to all labs](../README.md)
