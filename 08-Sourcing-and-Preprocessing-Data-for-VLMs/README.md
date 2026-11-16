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
- **Presenter:** Imon Banerjee, PhD — Mayo Clinic
- **Presenter:** Eduardo Farina, MD — Federal University of São Paulo (UNIFESP)
- **Presenter:** Alessia Guarnera, MD, PhD — UniCamillus, Rome, Italy

## Overview

This interactive workshop focuses on the "data-first" engineering required to build medical imaging datasets from the ground up. The session goes beyond model training to teach the foundational skills of a medical AI researcher: selecting a cohort from EHR and radiology report data, fetching studies via DICOM networking (pynetdicom), and implementing professional anonymization and quality control pipelines.

The workshop runs in a Colab notebook using public data and guides participants through transforming raw clinical inputs into structured, de-identified image-report pairs optimized for vision-language model (VLM) training. Attendees will leave with a framework for clinical data orchestration that can be adapted to any institution or research use case.

## Learning Objectives

By the end of this session, participants will be able to:

1. Demonstrate how to programmatically identify and select clinical cohorts by querying EHR databases and radiology reports, integrating disparate data sources into a unified research pipeline.
2. Execute end-to-end imaging retrieval and sanitization using pynetdicom for PACS communication and DICOM de-identification protocols to ensure HIPAA compliance.
3. Synthesize image-text pairs by applying NLP-based anonymization to free-text reports and synchronizing them with the corresponding imaging volumes.

## Materials

The proposed live lesson uses **one continuous main notebook**, with presenter handoffs between sections.
The complementary notebook is optional post-session material.

| Material | Link |
| --- | --- |
| Main notebook — sections 1–12 | [Open in Colab](https://colab.research.google.com/github/RSNA/AI-Deep-Learning-Lab-2026/blob/main/08-Sourcing-and-Preprocessing-Data-for-VLMs/notebooks/01_source_and_pair.ipynb) · [Source](notebooks/01_source_and_pair.ipynb) |
| Complementary practice — windowing, loader, splits and Arena | [Open in Colab](https://colab.research.google.com/github/RSNA/AI-Deep-Learning-Lab-2026/blob/main/08-Sourcing-and-Preprocessing-Data-for-VLMs/notebooks/02_complementary.ipynb) · [Source](notebooks/02_complementary.ipynb) |
| Faculty handoffs and readiness checklist | [Instructor guide](instructor-guide.md) |
| FHIR / DICOMweb route guide | [Image](assets/hospital-api-guide.png) |
| Image attribution | [Sources and modifications](assets/ATTRIBUTION.md) |

Colab links target the official main branch and become available after this submission is merged.

### Proposed session division

| Time (Central) | Lead | Content |
| --- | --- | --- |
| 9:30–9:35 | Felipe | Introduction and lab overview |
| 9:35–9:50 | Eduardo | Sections 1–6: FHIR, authentication, patient/study selection, order and encounter context |
| 9:50–10:05 | Imon | Sections 7–9: report–study matching, findings curation and QIDO/WADO retrieval |
| 10:05–10:20 | Alessia | Sections 10–12: image preprocessing, visual inspection, training pair and cohort exercise if time permits |
| 10:20–10:30 | Felipe | Wrap-up, questions, troubleshooting and catch-up |

Imon's [PR #11](https://github.com/RSNA/AI-Deep-Learning-Lab-2026/pull/11) separately proposes a CSV-based
report-matching notebook. Its exercise should be coordinated with sections 7–9 before the final rehearsal;
this submission neither replaces that PR nor claims the two notebooks are already integrated.
The primary lesson uses DICOMweb (QIDO/WADO); it does not implement the pynetdicom/de-identification
objectives in the original overview above, which require faculty alignment before finalization.

**Preparation status (November 16, 2026):** the rehearsal hospital was taken offline after testing.
Live FHIR/DICOMweb cells require the instructor to bring it online and supply a classroom token.
The embedded recovery points support only the single-case report/image-processing demonstration.
Fresh Google Colab validation remains pending. No participant credentials are included.

## Before the Session

- Use a free CPU runtime; no GPU or model weights are needed for the main lesson.
- The instructor supplies the hospital URL and classroom token; enter the token at the notebook prompt.
- Bring a laptop with a recent version of the [Chrome browser](https://www.google.com/chrome/).
- Make sure you can sign in to a Google account, which you need to run notebooks in [Google Colab](https://colab.research.google.com/).

---

[← Back to all labs](../README.md)
