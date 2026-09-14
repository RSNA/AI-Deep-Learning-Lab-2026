# Contributing Guidelines for Presenters

Thank you for teaching at the RSNA 2026 Deep Learning Labs! This guide explains how to add your materials to this repository.

## Key Deadline

> **Please have your complete materials (notebooks, slides, and updated README) merged into this repository no later than November 15, 2026.**

This gives the Deep Learning Lab director time to run every notebook as a participant would and flag issues before the meeting. After November 15, please limit changes to fixes identified during our review or critical bugs, and **please do not submit changes during the meeting itself**. Last-minute pull requests are very hard to review and merge while the labs are running.

## Your Lab Folder

Each lab has a dedicated folder, numbered in the order the labs are held. Please add files **only** to your own lab's folder.

| # | Folder |
| --- | --- |
| 01 | [`01-Low-Code-Introduction-to-AI-Agents`](./01-Low-Code-Introduction-to-AI-Agents/) |
| 02 | [`02-Production-Ready-Agentic-AI-Applications`](./02-Production-Ready-Agentic-AI-Applications/) |
| 03 | [`03-Introduction-to-Foundation-Models`](./03-Introduction-to-Foundation-Models/) |
| 04 | [`04-Evaluating-Deep-Learning-Models-for-Deployment`](./04-Evaluating-Deep-Learning-Models-for-Deployment/) |
| 05 | [`05-Vibe-Coding-101`](./05-Vibe-Coding-101/) |
| 06 | [`06-Pretrained-Embedding-Models`](./06-Pretrained-Embedding-Models/) |
| 07 | [`07-Fine-Tuning-Vision-Language-Models`](./07-Fine-Tuning-Vision-Language-Models/) |
| 08 | [`08-Sourcing-and-Preprocessing-Data-for-VLMs`](./08-Sourcing-and-Preprocessing-Data-for-VLMs/) |

Each folder already contains a `README.md` with your lab's schedule, faculty, overview, and learning objectives. Please review it for accuracy, then update the **Materials** section with links to your notebook(s), slides, and any setup participants need to complete in advance.

## How to Submit Your Materials

1. **Fork** this repository to your own GitHub account.
2. **Sync your fork** with the latest version of `main` before you start (and again before every pull request) so you don't overwrite other teams' updates. On GitHub, click **Sync fork** on your fork's page, or from the command line:

   ```bash
   git remote add upstream https://github.com/RSNA/AI-Deep-Learning-Lab-2026.git  # once
   git fetch upstream
   git merge upstream/main
   ```

3. **Add your materials** to your lab's folder.
   - **Colab notebooks:** In Colab, choose **File → Save a copy in GitHub**, select your fork, and set the file path to your lab folder (e.g., `05-Vibe-Coding-101/Vibe_Coding_101.ipynb`).
   - **Slides and other files:** Upload them to your lab folder through the GitHub web interface or with git. PDF is preferred for slides.
4. **Update your lab's `README.md`** with links to your materials (see the Colab badge example below).
5. **Open a pull request** from your fork to `RSNA/AI-Deep-Learning-Lab-2026` (`main` branch). Please start the title with your lab number, e.g., `Lab 05: Add notebook and slides`.

We will review and merge your pull request. Please batch your updates into a small number of pull requests rather than many small ones.

### "Open in Colab" Badge

Add a badge to your README so participants can open your notebook in one click. Replace the folder and file name with your own:

```markdown
[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/RSNA/AI-Deep-Learning-Lab-2026/blob/main/05-Vibe-Coding-101/Vibe_Coding_101.ipynb)
```

The link works once your notebook is merged into `main`.

## Notebook Guidelines

Expect a mix of experience levels in every lab, including participants with little or no background in AI, Python, Colab, or GitHub.

- **Run top to bottom on a fresh Colab runtime.** Test with **Runtime → Disconnect and delete runtime**, then **Run all**. If you need a GPU, say so clearly at the top of the notebook and confirm the lab works on the free Colab tier.
- **Provide completed versions of exercise cells.** If participants are expected to fill in code, put a completed version of the same code in the next cell so anyone who falls behind can keep going by simply running cells.
- **Explain each cell in Markdown.** You don't need to explain every line, but describe the general purpose of each code cell.
- **Pin package versions** in your install cell (e.g., `pip install package==1.2.3`) so the notebook doesn't break when a library updates.
- **Mind the clock.** Sessions are one hour. Precompute slow steps (e.g., long training runs) and load the results instead.
- **Never commit secrets.** Do not include API keys, tokens, or passwords in notebooks or files. If participants need their own keys, explain how to get them in advance and read them with Colab's **Secrets** feature (the key icon in the left sidebar) or an input prompt.
- **Use only public or fully de-identified data.** No protected health information (PHI) may be committed to this repository.

## Large Files

GitHub rejects files larger than 100 MB, and large files slow down cloning for everyone. Please keep datasets and model weights out of the repository. Instead, host them externally (e.g., Hugging Face, Zenodo, or a public cloud bucket) and download them within your notebook. If you need help hosting large files, please contact us.

## Questions

Please reach out to Pouria Rouzrokh, Director of the Deep Learning Labs, with any questions.
