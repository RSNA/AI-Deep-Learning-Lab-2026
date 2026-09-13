# Lab 08: An Introduction to Sourcing and Preprocessing Medical Imaging Data for Vision-Language Models

**RSNA 2026 Deep Learning Lab**

| | |
| --- | --- |
| **Date** | Wednesday, December 2, 2026 |
| **Time** | 9:30 – 10:30 AM (U.S. Central Time) |
| **Level** | Core |

> Dates and times may change. Please check the official RSNA 2026 Annual Meeting program for the latest schedule.

## Faculty

- **Moderator:** Felipe Kitamura, MD PhD — Eden
- **Presenter:** Imon Banerjee — Mayo Clinic
- **Presenter:** Eduardo Farina, MD — Federal University of São Paulo (UNIFESP)
- **Presenter:** Alessia Guarnera — UniCamillus International Medical University

## Overview

This interactive workshop focuses on the "data-first" engineering required to build medical imaging datasets from the ground up. The session goes beyond model training to teach the foundational skills of a medical AI researcher: selecting a cohort from EHR and radiology report data, fetching studies via DICOM networking (pynetdicom), and implementing professional anonymization and quality control pipelines.

The workshop runs in a Colab notebook using public data and guides participants through transforming raw clinical inputs into structured, de-identified image-report pairs optimized for vision-language model (VLM) training. Attendees will leave with a framework for clinical data orchestration that can be adapted to any institution or research use case.

## Learning Objectives

By the end of this session, participants will be able to:

1. Demonstrate how to programmatically identify and select clinical cohorts by querying EHR databases and radiology reports, integrating disparate data sources into a unified research pipeline.
2. Execute end-to-end imaging retrieval and sanitization using pynetdicom for PACS communication and DICOM de-identification protocols to ensure HIPAA compliance.
3. Synthesize image-text pairs by applying NLP-based anonymization to free-text reports and synchronizing them with the corresponding imaging volumes.

## Materials

Materials for this lab will be posted here before the meeting.

<!--
PRESENTERS: Replace the line above with links to your materials. For example:

| Material | Link |
| --- | --- |
| Notebook | [![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/RSNA/AI-Deep-Learning-Lab-2026/blob/main/08-Sourcing-and-Preprocessing-Data-for-VLMs/YOUR_NOTEBOOK.ipynb) |
| Slides | [Slides.pdf](./Slides.pdf) |

Also add any setup participants must complete before the session (e.g., accounts, API keys, runtime type).
See ../CONTRIBUTING.md for full instructions.
-->

## Before the Session

- Bring a laptop with a recent version of the [Chrome browser](https://www.google.com/chrome/).
- Make sure you can sign in to a Google account, which you need to run notebooks in [Google Colab](https://colab.research.google.com/).

---

[← Back to all labs](../README.md)
