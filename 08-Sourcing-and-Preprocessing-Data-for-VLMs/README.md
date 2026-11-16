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

Build a CXR training example through one continuous patient workflow: authenticate to the teaching
hospital, retrieve patient and visit context through FHIR, match the correct report to the selected
study, retrieve its image through DICOMweb, and prepare an image/context/Findings pair for a VLM.
The RIS uses fictional clinical records and the PACS serves a small, attributed teaching image pack.
The main lesson runs on a free Colab CPU runtime; model training is outside its scope.

## Learning Objectives

1. Use authenticated FHIR requests to find patients, imaging studies, orders, encounters and reports.
2. Match reports using accession and order identifiers, inspect distractors and extract Findings without Impression leakage.
3. Retrieve matched DICOM images with QIDO/WADO, verify their identifiers, apply display transformations and resize proportionally to a maximum of 896 pixels.
4. Assemble a multimodal training example with age, gender and reason for visit as context and Findings as the target.

This demonstration does not implement institutional de-identification or establish regulatory compliance.

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

Imon Banerjee's matching and report-curation exercise from [PR #11](https://github.com/RSNA/AI-Deep-Learning-Lab-2026/pull/11)
is integrated into sections 7–9. Her CSVs populate the teaching RIS and are retrieved through FHIR;
participants do not upload CSVs or switch notebooks. See [adaptation and attribution notes](report-matching-notes.md)
for preserved matching logic, CXR mapping and small correctness fixes. The selected CXR is aligned with
an actual Orthanc study; historical RIS-only records are explicitly distinguished from available images.

**Preparation status (November 16, 2026):** the [hospital](https://rsnalearninglab.eduardofarina.com)
is online. Both notebooks passed in independent local kernels against local Docker and public HTTPS.
A 40-student test completed 120 metadata requests and 40 DICOM downloads without errors.
Fresh Google Colab rehearsal and faculty review remain pending. Arena is optional complementary
material; successful live inference remains unverified after an earlier external GPU quota failure.
The instructor supplies classroom tokens. Planned hospital access continues through March 2, 2027.

## Before the Session

- Use a free CPU runtime; no GPU or model weights are needed for the main lesson.
- The instructor supplies the hospital URL and classroom token; enter the token at the notebook prompt.
- Bring a laptop with a recent version of the [Chrome browser](https://www.google.com/chrome/).
- Make sure you can sign in to a Google account, which you need to run notebooks in [Google Colab](https://colab.research.google.com/).

---

[← Back to all labs](../README.md)
