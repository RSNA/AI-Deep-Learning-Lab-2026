# Lab 05: Vibe Coding 101: Building Radiology Applications Without Programming Experience

**RSNA 2026 Deep Learning Lab**

| | |
| --- | --- |
| **Date** | Tuesday, December 1, 2026 |
| **Time** | 1:30 – 2:30 PM (U.S. Central Time) |
| **Level** | Core |

> Dates and times may change. Please check the official RSNA 2026 Annual Meeting program for the latest schedule.

## Faculty

- **Moderator/Presenter:** Tugba Akinci D'Antonoli, MD — University Hospital Basel
- **Presenter:** Keno Bressem, MD — Technical University of Munich
- **Presenter:** Walter Wiggins, MD PhD — Mosaic Clinical Technologies (Radiology Partners)

## Overview

This introductory, hands-on course equips radiology professionals to design and prototype simple applications with large language models (LLMs) without prior software development training. The session introduces "vibe coding": using natural language to guide AI systems in generating functional code, workflows, and basic user interfaces.

Participants learn prompt engineering techniques to translate clinical and operational needs into working outputs, enabling rapid prototyping of tools such as reporting assistants, workflow utilities, and data interaction interfaces. Through live demonstrations and guided exercises, attendees move from core model-communication principles to building radiology-relevant prototypes.

## Learning Objectives

By the end of this session, participants will be able to:

1. Explain core principles of prompt engineering and how structured natural language inputs influence LLM outputs in application development.
2. Describe the "vibe coding" paradigm and its relevance for rapid prototyping of radiology tools without traditional programming experience.
3. Develop basic AI-assisted radiology applications by translating clinical or workflow use cases into functional prompts and generated code.
4. Evaluate practical considerations, including usability, data sensitivity, and workflow integration, when deploying LLM-generated solutions in radiology settings.

## Materials

| Part | Material | Open |
|---|---|---|
| Talk 1 · Prompt Engineering Fundamentals (Tugba Akinci D'Antonoli) | [Lecture1-Prompt-Engineering.ipynb](Lecture1-Prompt-Engineering.ipynb) | [![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/RSNA/AI-Deep-Learning-Lab-2026/blob/main/05-Vibe-Coding-101/Lecture1-Prompt-Engineering.ipynb) |
| Talk 2 · Vibe Coding 101 (Keno Bressem)
| Hands-on · From Idea to Prototype (Walter Wiggins) | to be added | |

The notebook follows the talk step by step (how LLMs work, prompt-engineering techniques, building and testing a small tool, safeguards) and ends with a hands-on part for building your own tool.
All example reports are synthetic. **Never enter patient data.**

To keep your own changes, use **File → Save a copy in Drive** after opening the notebook in Colab.

## Before the Session

1. Bring a laptop with a recent version of the [Chrome browser](https://www.google.com/chrome/).
2. Make sure you can sign in to a Google account, which you need to run notebooks in [Google Colab](https://colab.research.google.com/).
3. **Get a free Gemini API key** at [Google AI Studio](https://aistudio.google.com/apikey) (sign in → *Create API key*). This takes about 2 minutes and saves time in the session.
4. Open the notebook in Colab, click the 🔑 **Secrets** icon in the left sidebar, add a secret named `GOOGLE_API_KEY` with your key as the value, and turn on *Notebook access*.
5. Run the first two cells. If you see `Connection OK`, you are ready.

No key, or no luck connecting? Set `PROVIDER = "offline"` in the first cell to follow along with example answers.

<!--
PRESENTERS: Replace the line above with links to your materials. For example:

| Material | Link |
| --- | --- |
| Notebook | [![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/RSNA/AI-Deep-Learning-Lab-2026/blob/main/05-Vibe-Coding-101/YOUR_NOTEBOOK.ipynb) |
| Slides | [Slides.pdf](./Slides.pdf) |

Also add any setup participants must complete before the session (e.g., accounts, API keys, runtime type).
See ../CONTRIBUTING.md for full instructions.
-->

## Before the Session

- Bring a laptop with a recent version of the [Chrome browser](https://www.google.com/chrome/).
- Make sure you can sign in to a Google account, which you need to run notebooks in [Google Colab](https://colab.research.google.com/).

---

[← Back to all labs](../README.md)
